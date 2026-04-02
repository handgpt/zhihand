import { createServer as createHTTPServer, type IncomingMessage, type ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
// Transport type used only for cleanup interface

import { createServer as createMcpServer } from "../index.ts";
import {
  resolveConfig,
  loadBackendConfig,
  saveBackendConfig,
  resolveZhiHandDir,
  ensureZhiHandDir,
  type BackendName,
  type ZhiHandConfig,
} from "../core/config.ts";
import { startHeartbeatLoop, stopHeartbeatLoop, sendBrainOffline } from "./heartbeat.ts";
import { PromptListener, type MobilePrompt } from "./prompt-listener.ts";
import { dispatchToCLI, postReply, killActiveChild } from "./dispatcher.ts";

const DEFAULT_PORT = 18686;
const PID_FILE = "daemon.pid";

// ── State ──────────────────────────────────────────────────

let activeBackend: Exclude<BackendName, "openclaw"> | null = null;
let isProcessing = false;
const promptQueue: MobilePrompt[] = [];

function log(msg: string): void {
  const ts = new Date().toLocaleTimeString();
  process.stdout.write(`[${ts}] ${msg}\n`);
}

// ── Prompt Processing ──────────────────────────────────────

async function processPrompt(config: ZhiHandConfig, prompt: MobilePrompt): Promise<void> {
  if (!activeBackend) {
    log(`[relay] No backend configured. Replying with error.`);
    await postReply(config, prompt.id, "No AI backend configured. Run: zhihand gemini / zhihand claude / zhihand codex");
    return;
  }

  const preview = prompt.text.length > 40 ? prompt.text.slice(0, 40) + "..." : prompt.text;
  log(`[relay] Prompt: "${preview}" → dispatching to ${activeBackend}...`);

  const result = await dispatchToCLI(activeBackend, prompt.text, log);
  const ok = await postReply(config, prompt.id, result.text);
  const dur = (result.durationMs / 1000).toFixed(1);

  if (ok) {
    log(`[relay] Reply posted (${dur}s, ${result.success ? "ok" : "error"}).`);
  } else {
    log(`[relay] Failed to post reply for prompt ${prompt.id}.`);
  }
}

async function processQueue(config: ZhiHandConfig): Promise<void> {
  while (promptQueue.length > 0) {
    isProcessing = true;
    const next = promptQueue.shift()!;
    await processPrompt(config, next);
  }
  isProcessing = false;
}

function onPromptReceived(config: ZhiHandConfig, prompt: MobilePrompt): void {
  promptQueue.push(prompt);
  if (!isProcessing) {
    processQueue(config);
  }
}

// ── Internal API ───────────────────────────────────────────

function handleInternalAPI(req: IncomingMessage, res: ServerResponse): boolean {
  const url = req.url ?? "";

  if (url === "/internal/backend" && req.method === "POST") {
    let body = "";
    const MAX_BODY = 10 * 1024; // 10KB
    req.on("data", (chunk: Buffer) => {
      body += chunk.toString();
      if (body.length > MAX_BODY) {
        res.writeHead(413, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Payload too large" }));
        req.destroy();
        return;
      }
    });
    req.on("end", () => {
      try {
        const { backend } = JSON.parse(body) as { backend: string };
        const allowed = ["claudecode", "codex", "gemini"];
        if (!allowed.includes(backend)) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: `Invalid backend. Allowed: ${allowed.join(", ")}` }));
          return;
        }
        activeBackend = backend as Exclude<BackendName, "openclaw">;
        saveBackendConfig({ activeBackend });
        log(`[config] Backend switched to ${activeBackend}.`);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true, backend: activeBackend }));
      } catch {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Invalid JSON" }));
      }
    });
    return true;
  }

  if (url === "/internal/status" && req.method === "GET") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      backend: activeBackend,
      processing: isProcessing,
      queueLength: promptQueue.length,
      pid: process.pid,
    }));
    return true;
  }

  return false;
}

// ── PID Management ─────────────────────────────────────────

function getPidPath(): string {
  return path.join(resolveZhiHandDir(), PID_FILE);
}

function writePid(): void {
  ensureZhiHandDir();
  fs.writeFileSync(getPidPath(), String(process.pid), { mode: 0o600 });
}

function removePid(): void {
  try { fs.unlinkSync(getPidPath()); } catch { /* ignore */ }
}

function readPid(): number | null {
  try {
    const pid = parseInt(fs.readFileSync(getPidPath(), "utf8").trim(), 10);
    if (isNaN(pid)) return null;
    // Check if process is still alive
    try { process.kill(pid, 0); return pid; } catch { return null; }
  } catch {
    return null;
  }
}

export function isAlreadyRunning(): number | null {
  return readPid();
}

// ── Main Daemon Entry ──────────────────────────────────────

export async function startDaemon(options?: {
  port?: number;
  deviceName?: string;
}): Promise<void> {
  const port = options?.port ?? (parseInt(process.env.ZHIHAND_PORT ?? "", 10) || DEFAULT_PORT);

  // Check if already running
  const existingPid = readPid();
  if (existingPid) {
    log(`Daemon already running (PID ${existingPid}). Use 'zhihand stop' first.`);
    process.exit(1);
  }

  // Load config
  let config: ZhiHandConfig;
  try {
    config = resolveConfig(options?.deviceName);
  } catch (err) {
    log(`Error: ${(err as Error).message}`);
    log("Run 'zhihand setup' to pair a device first.");
    process.exit(1);
  }

  // Load backend
  const backendConfig = loadBackendConfig();
  activeBackend = (backendConfig.activeBackend as Exclude<BackendName, "openclaw">) ?? null;

  // Create MCP server + single transport (MCP SDK: one connect() per server)
  const mcpServer = createMcpServer(options?.deviceName);
  const mcpTransport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
  });
  await mcpServer.connect(mcpTransport);
  log(`[mcp] Transport connected.`);

  // Create HTTP server
  const httpServer = createHTTPServer(async (req, res) => {
    // Internal API
    if (req.url?.startsWith("/internal/")) {
      if (handleInternalAPI(req, res)) return;
      res.writeHead(404);
      res.end();
      return;
    }

    // MCP endpoint — route all requests to the single transport
    if (req.url === "/mcp" || req.url?.startsWith("/mcp")) {
      try {
        await mcpTransport.handleRequest(req, res);
      } catch (err) {
        if (!res.headersSent) {
          res.writeHead(500);
          res.end(`MCP error: ${(err as Error).message}`);
        }
      }
      return;
    }

    // Health check
    if (req.url === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "ok", pid: process.pid }));
      return;
    }

    res.writeHead(404);
    res.end();
  });

  // Start HTTP server on 127.0.0.1 ONLY (security: no 0.0.0.0)
  await new Promise<void>((resolve, reject) => {
    httpServer.once("error", (err) => {
      if ((err as NodeJS.ErrnoException).code === "EADDRINUSE") {
        log(`Error: Port ${port} is already in use. Set ZHIHAND_PORT to use a different port.`);
        process.exit(1);
      }
      reject(err);
    });
    httpServer.listen(port, "127.0.0.1", () => resolve());
  });

  writePid();

  // Start heartbeat
  startHeartbeatLoop(config, log);

  // Start prompt listener
  const promptListener = new PromptListener(
    config,
    (prompt) => onPromptReceived(config, prompt),
    log,
  );
  promptListener.start();

  log(`ZhiHand daemon started.`);
  log(`  PID: ${process.pid}`);
  log(`  MCP: http://127.0.0.1:${port}/mcp`);
  log(`  Backend: ${activeBackend ?? "(none)"}`);
  log(`  Device: ${config.credentialId}`);
  log(`Listening for prompts...`);

  // Graceful shutdown
  const shutdown = async () => {
    log("\nShutting down...");
    promptListener.stop();
    stopHeartbeatLoop();
    await killActiveChild();
    await sendBrainOffline(config);
    // Close MCP transport
    try { await mcpTransport.close(); } catch { /* ignore */ }
    httpServer.close();
    removePid();
    log("Daemon stopped.");
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

export function stopDaemon(): boolean {
  const pid = readPid();
  if (!pid) {
    return false;
  }
  try {
    process.kill(pid, "SIGTERM");
    return true;
  } catch {
    // Process already dead, clean up PID file
    removePid();
    return false;
  }
}

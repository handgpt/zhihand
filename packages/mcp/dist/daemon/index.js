import { createServer as createHTTPServer } from "node:http";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
// Transport type used only for cleanup interface
import { createServer as createMcpServer } from "../index.js";
import { resolveConfig, loadBackendConfig, saveBackendConfig, resolveZhiHandDir, ensureZhiHandDir, DEFAULT_MODELS, } from "../core/config.js";
import { PACKAGE_VERSION } from "../index.js";
import { startHeartbeatLoop, stopHeartbeatLoop, sendBrainOffline, setBrainMeta } from "./heartbeat.js";
import { PromptListener } from "./prompt-listener.js";
import { dispatchToCLI, postReply, killActiveChild } from "./dispatcher.js";
import { setDebugEnabled, dbg } from "./logger.js";
import { registry } from "../core/registry.js";
import { enqueueCommand } from "../core/command.js";
import { waitForCommandAck } from "../core/ws.js";
const DEFAULT_PORT = 18686;
const PID_FILE = "daemon.pid";
// ── State ────────���─────────────────────────────────────────
let activeBackend = null;
let activeModel = null; // user-selected model alias, null = use default
let isProcessing = false;
const promptQueue = [];
import { log as coreLog, setTimestampEnabled } from "../core/logger.js";
function log(msg) {
    coreLog.info(msg);
}
// ── Prompt Processing ──────────────────────────────────────
async function processPrompt(config, prompt) {
    if (!activeBackend) {
        log(`[relay] No backend configured. Replying with error.`);
        await postReply(config, prompt.id, "No AI backend configured. Run: zhihand gemini / zhihand claude / zhihand codex");
        return;
    }
    const preview = prompt.text.length > 40 ? prompt.text.slice(0, 40) + "..." : prompt.text;
    log(`[relay] Prompt: "${preview}" → dispatching to ${activeBackend}...`);
    dbg(`[relay] Prompt ID: ${prompt.id}, full text (${prompt.text.length} chars): ${prompt.text}`);
    dbg(`[relay] Prompt metadata: status=${prompt.status}, edge_id=${prompt.edge_id}, created_at=${prompt.created_at}`);
    const result = await dispatchToCLI(activeBackend, prompt.text, log, activeModel ?? undefined);
    dbg(`[relay] Dispatch result: success=${result.success}, duration=${result.durationMs}ms, text length=${result.text.length}`);
    dbg(`[relay] Reply text: ${result.text.slice(0, 500)}${result.text.length > 500 ? "..." : ""}`);
    const ok = await postReply(config, prompt.id, result.text);
    const dur = (result.durationMs / 1000).toFixed(1);
    if (ok) {
        log(`[relay] Reply posted (${dur}s, ${result.success ? "ok" : "error"}).`);
    }
    else {
        log(`[relay] Failed to post reply for prompt ${prompt.id}.`);
    }
}
async function processQueue(config) {
    while (promptQueue.length > 0) {
        isProcessing = true;
        const next = promptQueue.shift();
        await processPrompt(config, next);
    }
    isProcessing = false;
}
function onPromptReceived(config, prompt) {
    promptQueue.push(prompt);
    dbg(`[queue] Enqueued prompt ${prompt.id}, queue length: ${promptQueue.length}, processing: ${isProcessing}`);
    if (!isProcessing) {
        processQueue(config);
    }
}
// ── Internal API ───────────────────────────────────────────
function handleInternalAPI(req, res) {
    const url = req.url ?? "";
    if (url === "/internal/backend" && req.method === "POST") {
        dbg(`[api] POST /internal/backend from ${req.socket.remoteAddress}`);
        let body = "";
        const MAX_BODY = 10 * 1024; // 10KB
        req.on("data", (chunk) => {
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
                const { backend, model } = JSON.parse(body);
                const allowed = ["claudecode", "codex", "gemini"];
                if (!allowed.includes(backend)) {
                    res.writeHead(400, { "Content-Type": "application/json" });
                    res.end(JSON.stringify({ error: `Invalid backend. Allowed: ${allowed.join(", ")}` }));
                    return;
                }
                activeBackend = backend;
                activeModel = model ?? null;
                saveBackendConfig({ activeBackend, model: activeModel });
                const effectiveModel = activeModel ?? DEFAULT_MODELS[activeBackend];
                setBrainMeta({ backend: activeBackend, model: effectiveModel });
                log(`[config] Backend switched to ${activeBackend}, model: ${effectiveModel}`);
                res.writeHead(200, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ ok: true, backend: activeBackend, model: effectiveModel }));
            }
            catch {
                res.writeHead(400, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ error: "Invalid JSON" }));
            }
        });
        return true;
    }
    // Execute command via daemon's WS (used by zhihand test)
    if (url === "/internal/exec" && req.method === "POST") {
        let body = "";
        const MAX_BODY = 10 * 1024;
        req.on("data", (chunk) => {
            body += chunk.toString();
            if (body.length > MAX_BODY) {
                res.writeHead(413, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ error: "Payload too large" }));
                req.destroy();
            }
        });
        req.on("end", async () => {
            const t0 = Date.now();
            try {
                const { command, credentialId, timeoutMs } = JSON.parse(body);
                const cmdType = command.type ?? "unknown";
                const cmdAction = command.payload?.action ?? "-";
                dbg(`[api] POST /internal/exec cred=${credentialId} type=${cmdType} action=${cmdAction} timeout=${timeoutMs ?? 10_000}ms`);
                const cfg = resolveConfig(credentialId);
                const effectiveTimeout = timeoutMs ?? 10_000;
                const queued = await enqueueCommand(cfg, command);
                dbg(`[api] /internal/exec enqueued id=${queued.id}`);
                const ack = await waitForCommandAck(cfg, {
                    commandId: queued.id,
                    timeoutMs: effectiveTimeout,
                });
                const ms = Date.now() - t0;
                const ackStatus = ack.acked ? (ack.command?.ack_status ?? "ok") : "timeout";
                dbg(`[api] /internal/exec done id=${queued.id} acked=${ack.acked} status=${ackStatus} ${ms}ms`);
                res.writeHead(200, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ id: queued.id, ...ack }));
            }
            catch (err) {
                dbg(`[api] /internal/exec error: ${err.message} ${Date.now() - t0}ms`);
                res.writeHead(500, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ error: err.message }));
            }
        });
        return true;
    }
    if (url === "/internal/status" && req.method === "GET") {
        dbg(`[api] GET /internal/status`);
        const effectiveModel = activeBackend ? (activeModel ?? DEFAULT_MODELS[activeBackend]) : null;
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
            version: PACKAGE_VERSION,
            backend: activeBackend,
            model: effectiveModel,
            processing: isProcessing,
            queueLength: promptQueue.length,
            pid: process.pid,
        }));
        return true;
    }
    return false;
}
// ── PID Management ─────────────────────────────────────────
function getPidPath() {
    return path.join(resolveZhiHandDir(), PID_FILE);
}
function writePid() {
    ensureZhiHandDir();
    fs.writeFileSync(getPidPath(), String(process.pid), { mode: 0o600 });
}
function removePid() {
    try {
        fs.unlinkSync(getPidPath());
    }
    catch { /* ignore */ }
}
function readPid() {
    try {
        const pid = parseInt(fs.readFileSync(getPidPath(), "utf8").trim(), 10);
        if (isNaN(pid))
            return null;
        // Check if process is still alive
        try {
            process.kill(pid, 0);
            return pid;
        }
        catch {
            return null;
        }
    }
    catch {
        return null;
    }
}
export function isAlreadyRunning() {
    return readPid();
}
// ── Main Daemon Entry ──────���───────────────────────────────
export async function startDaemon(options) {
    setTimestampEnabled(true);
    if (options?.debug)
        setDebugEnabled(true);
    const port = options?.port ?? (parseInt(process.env.ZHIHAND_PORT ?? "", 10) || DEFAULT_PORT);
    // Check if already running
    const existingPid = readPid();
    if (existingPid) {
        log(`Daemon already running (PID ${existingPid}). Use 'zhihand stop' first.`);
        process.exit(1);
    }
    // Load config
    let config;
    try {
        config = resolveConfig(options?.deviceName);
    }
    catch (err) {
        log(`Error: ${err.message}`);
        log("Run 'zhihand pair' to pair a device first.");
        process.exit(1);
    }
    // Load backend + model
    const backendConfig = loadBackendConfig();
    activeBackend = backendConfig.activeBackend ?? null;
    activeModel = backendConfig.model ?? null;
    // Log startup info + set brain meta for heartbeat
    log(`ZhiHand v${PACKAGE_VERSION} starting...`);
    if (options?.debug)
        log(`[config] Debug mode enabled — verbose logging active`);
    if (activeBackend) {
        const effectiveModel = activeModel ?? DEFAULT_MODELS[activeBackend];
        log(`[config] Backend: ${activeBackend}, Model: ${effectiveModel}`);
        setBrainMeta({ backend: activeBackend, model: effectiveModel });
    }
    else {
        log(`[config] No backend configured. Use: zhihand gemini / zhihand claude / zhihand codex`);
    }
    // Init the multi-device registry and log profile.
    await registry.init();
    const defaultState = registry.resolveDefault();
    if (defaultState?.profile) {
        const s = defaultState.profile;
        log(`[device] ${s.platform} ${s.model} (${s.osVersion}), ${s.screenWidthPx}x${s.screenHeightPx}, ${s.locale}`);
    }
    else {
        log(`[device] Device profile not available — tool descriptions will use generic defaults`);
    }
    // MCP sessions: each client gets its own McpServer + Transport pair
    // because McpServer.connect() can only be called once per instance
    const MAX_MCP_SESSIONS = 20;
    const SESSION_IDLE_TIMEOUT = 30 * 60 * 1000; // 30 minutes
    const mcpSessions = new Map();
    // Evict idle MCP sessions periodically
    const sessionCleanupTimer = setInterval(() => {
        const now = Date.now();
        for (const [sid, session] of mcpSessions) {
            if (session.activeRequests === 0 && now - session.lastActivity > SESSION_IDLE_TIMEOUT) {
                log(`[mcp] Evicting idle session: ${sid.slice(0, 8)}...`);
                session.transport.close().catch(() => { });
                mcpSessions.delete(sid);
            }
        }
    }, 60_000);
    // Create HTTP server
    const httpServer = createHTTPServer(async (req, res) => {
        // Internal API
        if (req.url?.startsWith("/internal/")) {
            if (handleInternalAPI(req, res))
                return;
            res.writeHead(404);
            res.end();
            return;
        }
        // MCP endpoint — per-session server + transport
        if (req.url === "/mcp" || req.url?.startsWith("/mcp")) {
            try {
                const sessionId = req.headers["mcp-session-id"];
                dbg(`[mcp] ${req.method} /mcp session=${sessionId?.slice(0, 8) ?? "(new)"} sessions=${mcpSessions.size}`);
                if (sessionId && mcpSessions.has(sessionId)) {
                    // Existing session
                    const session = mcpSessions.get(sessionId);
                    session.lastActivity = Date.now();
                    session.activeRequests++;
                    try {
                        await session.transport.handleRequest(req, res);
                    }
                    finally {
                        session.activeRequests--;
                    }
                }
                else if (!sessionId) {
                    // New session: create dedicated McpServer + Transport
                    const server = createMcpServer();
                    const transport = new StreamableHTTPServerTransport({
                        sessionIdGenerator: () => randomUUID(),
                        onsessioninitialized: (sid) => {
                            // Evict oldest session if at capacity
                            if (mcpSessions.size >= MAX_MCP_SESSIONS) {
                                let oldestSid = null;
                                let oldestTime = Infinity;
                                for (const [s, sess] of mcpSessions) {
                                    if (sess.activeRequests === 0 && sess.lastActivity < oldestTime) {
                                        oldestTime = sess.lastActivity;
                                        oldestSid = s;
                                    }
                                }
                                if (oldestSid) {
                                    log(`[mcp] Evicting oldest session (at cap): ${oldestSid.slice(0, 8)}...`);
                                    mcpSessions.get(oldestSid)?.transport.close().catch(() => { });
                                    mcpSessions.delete(oldestSid);
                                }
                            }
                            mcpSessions.set(sid, { server, transport, lastActivity: Date.now(), activeRequests: 0 });
                            log(`[mcp] Session started: ${sid.slice(0, 8)}...`);
                        },
                        onsessionclosed: (sid) => {
                            mcpSessions.delete(sid);
                            log(`[mcp] Session closed: ${sid.slice(0, 8)}...`);
                        },
                    });
                    await server.connect(transport);
                    await transport.handleRequest(req, res);
                }
                else {
                    // Unknown/expired session ID
                    res.writeHead(400, { "Content-Type": "application/json" });
                    res.end(JSON.stringify({
                        jsonrpc: "2.0",
                        error: { code: -32000, message: "Invalid or expired session" },
                        id: null,
                    }));
                }
            }
            catch (err) {
                if (!res.headersSent) {
                    res.writeHead(500);
                    res.end(`MCP error: ${err.message}`);
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
    await new Promise((resolve, reject) => {
        httpServer.once("error", (err) => {
            if (err.code === "EADDRINUSE") {
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
    const promptListener = new PromptListener(config, (prompt) => onPromptReceived(config, prompt), log);
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
        clearInterval(sessionCleanupTimer);
        await killActiveChild();
        await sendBrainOffline(config);
        // Close all MCP sessions
        for (const session of mcpSessions.values()) {
            try {
                await session.transport.close();
            }
            catch { /* ignore */ }
        }
        mcpSessions.clear();
        registry.shutdown();
        httpServer.close();
        removePid();
        log("Daemon stopped.");
        process.exit(0);
    };
    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
}
export function stopDaemon() {
    const pid = readPid();
    if (!pid) {
        return false;
    }
    try {
        process.kill(pid, "SIGTERM");
        return true;
    }
    catch {
        // Process already dead, clean up PID file
        removePid();
        return false;
    }
}

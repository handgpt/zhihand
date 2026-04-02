import { spawn } from "node:child_process";
import fsp from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
const CLI_TIMEOUT = 120_000; // 120s
const SIGKILL_DELAY = 2_000; // 2s after SIGTERM
const MAX_OUTPUT_BYTES = 100 * 1024; // 100KB
// Gemini session file polling
const SESSION_POLL_INTERVAL = 1_000; // 1s
const SESSION_STABILITY_DELAY = 2_000; // wait 2s after outcome before returning
// Resolve pty-wrap.py relative to this file (works from both src/ and dist/)
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PTY_WRAP_SCRIPT = path.resolve(__dirname, "../../scripts/pty-wrap.py");
// Gemini session directories
const GEMINI_TMP_DIR = path.join(os.homedir(), ".gemini", "tmp");
let activeChild = null;
// ── Gemini Session File Monitoring ─────────────────────────
/** Safely read and parse a JSON file (single attempt, async). */
async function loadJsonFile(filePath) {
    try {
        const raw = await fsp.readFile(filePath, "utf8");
        const parsed = JSON.parse(raw);
        return typeof parsed === "object" && parsed !== null ? parsed : null;
    }
    catch {
        // File locked or partial write — next poll cycle will retry
        return null;
    }
}
/** Extract text content from a gemini session message. */
function extractMessageText(message) {
    const content = message.content;
    if (typeof content === "string")
        return content;
    if (Array.isArray(content)) {
        return content
            .map((item) => {
            if (typeof item === "string")
                return item;
            if (typeof item === "object" && item !== null) {
                const obj = item;
                if (typeof obj.text === "string")
                    return obj.text;
                if (typeof obj.output === "string")
                    return obj.output;
            }
            return "";
        })
            .join("");
    }
    if (typeof content === "object" && content !== null) {
        const obj = content;
        if (typeof obj.text === "string")
            return obj.text;
    }
    // Fallback to displayContent
    const display = message.displayContent;
    if (typeof display === "string")
        return display;
    return "";
}
/** Check if a message has active (non-terminal) tool calls. */
function hasActiveToolCalls(message) {
    if (String(message.type ?? "").trim() !== "gemini")
        return false;
    const toolCalls = message.toolCalls;
    if (!Array.isArray(toolCalls))
        return false;
    const terminalStatuses = new Set(["completed", "cancelled", "errored", "failed"]);
    for (const tc of toolCalls) {
        if (typeof tc !== "object" || tc === null)
            continue;
        const status = String(tc.status ?? "").trim().toLowerCase();
        if (status && !terminalStatuses.has(status))
            return true;
    }
    return false;
}
/**
 * Check session messages for completion.
 * Returns [status, text] or null if still in progress.
 */
function checkSessionOutcome(messages) {
    if (messages.length === 0)
        return null;
    // Get the latest turn messages (trailing messages from last user input)
    const trailing = [];
    for (let i = messages.length - 1; i >= 0; i--) {
        const msg = messages[i];
        if (String(msg.type ?? "").trim() === "user")
            break;
        trailing.unshift(msg);
    }
    if (trailing.length === 0)
        return null;
    // If any message has active tool calls, still in progress
    for (const msg of trailing) {
        if (hasActiveToolCalls(msg))
            return null;
    }
    // Check from last message backwards for a result
    for (let i = trailing.length - 1; i >= 0; i--) {
        const msg = trailing[i];
        const msgType = String(msg.type ?? "").trim();
        // Error/warning/info messages
        if (["error", "warning", "info"].includes(msgType)) {
            const text = extractMessageText(msg).trim();
            if (text)
                return ["error", text];
        }
        // Gemini response message
        if (msgType === "gemini") {
            const text = extractMessageText(msg).trim();
            if (text)
                return ["success", text];
            if (hasActiveToolCalls(msg))
                return null;
        }
    }
    return null;
}
/**
 * Find the most recently created session file in the gemini tmp directory
 * that was created after `afterTime`. Validates that the session contains
 * our prompt text to avoid picking up unrelated gemini sessions.
 */
async function findLatestSessionFile(afterTime, promptText) {
    try {
        const entries = await fsp.readdir(GEMINI_TMP_DIR, { withFileTypes: true });
        const candidates = [];
        for (const entry of entries) {
            if (!entry.isDirectory())
                continue;
            const chatsDir = path.join(GEMINI_TMP_DIR, entry.name, "chats");
            try {
                await fsp.access(chatsDir);
            }
            catch {
                continue;
            }
            const chatFiles = await fsp.readdir(chatsDir);
            for (const f of chatFiles) {
                if (!f.startsWith("session-") || !f.endsWith(".json"))
                    continue;
                const fullPath = path.join(chatsDir, f);
                const stat = await fsp.stat(fullPath);
                if (stat.mtimeMs > afterTime) {
                    candidates.push({ path: fullPath, mtime: stat.mtimeMs });
                }
            }
        }
        // Sort newest first, then validate content matches our prompt
        candidates.sort((a, b) => b.mtime - a.mtime);
        const promptPrefix = promptText.slice(0, 50);
        for (const candidate of candidates) {
            const data = await loadJsonFile(candidate.path);
            if (!data || !Array.isArray(data.messages))
                continue;
            // Check first user message matches our prompt
            for (const msg of data.messages) {
                if (String(msg.type ?? "").trim() !== "user")
                    continue;
                const text = extractMessageText(msg);
                if (text.startsWith(promptPrefix))
                    return candidate.path;
                break; // Only check first user message
            }
        }
        return null;
    }
    catch {
        return null;
    }
}
/**
 * Poll gemini session files for the response.
 * Returns the final text when gemini completes, or null on timeout.
 */
function pollGeminiSession(child, startTime, promptText, log) {
    return new Promise((resolve) => {
        let sessionFile = null;
        let outcomeAt = null;
        let finalResult = null;
        let settled = false;
        let pollTimeout = null;
        function settle(result) {
            if (settled)
                return;
            settled = true;
            if (pollTimeout)
                clearTimeout(pollTimeout);
            // Kill the gemini process now that we have the answer
            closeChild(child);
            resolve(result);
        }
        async function poll() {
            if (settled)
                return;
            const elapsed = Date.now() - startTime;
            // Timeout
            if (elapsed > CLI_TIMEOUT) {
                closeChild(child);
                settle({
                    text: "Gemini timed out after 120s.",
                    success: false,
                    durationMs: elapsed,
                });
                return;
            }
            // Find session file if not yet found
            if (!sessionFile) {
                sessionFile = await findLatestSessionFile(startTime, promptText);
                if (sessionFile) {
                    log(`[gemini] Session file found: ${path.basename(sessionFile)}`);
                }
                schedulePoll();
                return;
            }
            // Read session file and check for outcome
            const conversation = await loadJsonFile(sessionFile);
            if (!conversation) {
                schedulePoll();
                return;
            }
            const messages = conversation.messages;
            if (!Array.isArray(messages)) {
                schedulePoll();
                return;
            }
            const outcome = checkSessionOutcome(messages);
            if (!outcome) {
                // Still in progress, reset stability timer
                outcomeAt = null;
                finalResult = null;
                schedulePoll();
                return;
            }
            // Outcome detected — wait for stability (2s) before returning
            if (!outcomeAt) {
                outcomeAt = Date.now();
                finalResult = outcome;
                schedulePoll();
                return;
            }
            if (Date.now() - outcomeAt >= SESSION_STABILITY_DELAY) {
                const [status, text] = finalResult ?? outcome;
                settle({
                    text,
                    success: status === "success",
                    durationMs: Date.now() - startTime,
                });
            }
            else {
                schedulePoll();
            }
        }
        function schedulePoll() {
            if (settled)
                return;
            pollTimeout = setTimeout(() => { poll(); }, SESSION_POLL_INTERVAL);
        }
        // Start polling
        schedulePoll();
        // Also handle process exit (in case it crashes before producing session file)
        child.on("close", (code) => {
            if (settled)
                return;
            // Give a final chance to read the session file
            setTimeout(async () => {
                if (settled)
                    return;
                if (sessionFile) {
                    const conversation = await loadJsonFile(sessionFile);
                    if (conversation && Array.isArray(conversation.messages)) {
                        const outcome = checkSessionOutcome(conversation.messages);
                        if (outcome) {
                            settle({
                                text: outcome[1],
                                success: outcome[0] === "success",
                                durationMs: Date.now() - startTime,
                            });
                            return;
                        }
                    }
                }
                settle({
                    text: `Gemini process exited with code ${code} before producing a response.`,
                    success: false,
                    durationMs: Date.now() - startTime,
                });
            }, 500);
        });
    });
}
/** Gracefully close a child process: EOF → SIGTERM → SIGKILL. */
function closeChild(child) {
    if (child.killed || child.exitCode !== null)
        return;
    // Try SIGTERM first
    child.kill("SIGTERM");
    setTimeout(() => {
        if (!child.killed && child.exitCode === null) {
            child.kill("SIGKILL");
        }
    }, SIGKILL_DELAY);
}
/**
 * Kill the active child process. Returns a promise that resolves
 * when the child has exited (or immediately if no child).
 */
export function killActiveChild() {
    if (!activeChild || activeChild.killed) {
        return Promise.resolve();
    }
    return new Promise((resolve) => {
        const child = activeChild;
        child.once("close", () => resolve());
        closeChild(child);
        // Safety: resolve after SIGKILL_DELAY + 1s even if no close event
        setTimeout(() => resolve(), SIGKILL_DELAY + 1000);
    });
}
// ── Dispatch Entrypoint ────────────────────────────────────
export function dispatchToCLI(backend, prompt, log, model) {
    const startTime = Date.now();
    if (backend === "gemini") {
        return dispatchGemini(prompt, startTime, log, model);
    }
    if (backend === "codex") {
        return dispatchCodex(prompt, startTime, model);
    }
    if (backend === "claudecode") {
        return dispatchClaude(prompt, startTime, model);
    }
    return Promise.resolve({
        text: `Unsupported backend: ${backend}`,
        success: false,
        durationMs: 0,
    });
}
// ── Gemini Dispatch (PTY + Session File Monitoring) ────────
function dispatchGemini(prompt, startTime, log, model) {
    const geminiModel = model ?? process.env.CLAUDE_GEMINI_MODEL ?? "gemini-3.1-pro-preview";
    const cliArgs = [
        "--approval-mode", "yolo",
        "--model", geminiModel,
        "-i", prompt,
    ];
    const env = {
        ...process.env,
        GEMINI_SANDBOX: "false",
        TERM: "xterm-256color",
        COLORTERM: "truecolor",
    };
    // Wrap with PTY so gemini sees isatty()==true
    const child = spawn("python3", [PTY_WRAP_SCRIPT, "gemini", ...cliArgs], {
        env,
        stdio: ["ignore", "pipe", "pipe"],
        detached: false,
    });
    activeChild = child;
    // Drain PTY output (discard — we read from session file instead)
    child.stdout?.resume();
    child.stderr?.resume();
    return pollGeminiSession(child, startTime, prompt, log);
}
// ── Codex Dispatch ─────────────────────────────────────────
function dispatchCodex(prompt, startTime, model) {
    // codex exec --full-auto --skip-git-repo-check --json [-m model] <prompt>
    const args = ["exec", "--full-auto", "--skip-git-repo-check", "--json"];
    const codexModel = model ?? process.env.CLAUDE_CODEX_MODEL;
    if (codexModel) {
        args.push("-m", codexModel);
    }
    args.push(prompt);
    const child = spawn("codex", args, {
        env: process.env,
        stdio: ["ignore", "pipe", "pipe"],
        detached: false,
    });
    activeChild = child;
    return collectCodexOutput(child, startTime);
}
// ── Claude Dispatch ────────────────────────────────────────
function dispatchClaude(prompt, startTime, model) {
    const child = spawn("claude", ["-p", prompt, "--output-format", "json"], {
        env: process.env,
        stdio: ["ignore", "pipe", "pipe"],
        detached: false,
    });
    activeChild = child;
    return collectChildOutput(child, startTime);
}
// ── Codex JSONL Output Parser ──────────────────────────────
/** Parse codex JSONL output and extract agent message text. */
function parseCodexJsonl(raw) {
    const lines = raw.split("\n").filter(Boolean);
    const texts = [];
    let hasError = false;
    for (const line of lines) {
        try {
            const event = JSON.parse(line);
            const type = String(event.type ?? "");
            // Extract text from completed agent messages
            if (type === "item.completed") {
                const item = event.item;
                if (item && typeof item.text === "string" && item.text.trim()) {
                    texts.push(item.text.trim());
                }
            }
            // Capture errors
            if (type === "error") {
                const msg = String(event.message ?? "");
                if (msg)
                    texts.push(`Error: ${msg}`);
                hasError = true;
            }
            if (type === "turn.failed") {
                hasError = true;
            }
        }
        catch {
            // Not valid JSON — skip (truncated line or stderr mixed in)
        }
    }
    if (texts.length > 0) {
        return { text: texts.join("\n\n"), success: !hasError };
    }
    return { text: raw.trim(), success: false };
}
function collectCodexOutput(child, startTime) {
    return new Promise((resolve) => {
        const chunks = [];
        let totalBytes = 0;
        let truncated = false;
        let settled = false;
        function settle(result) {
            if (settled)
                return;
            settled = true;
            resolve(result);
        }
        const timer = setTimeout(() => { closeChild(child); }, CLI_TIMEOUT);
        const collectOutput = (data) => {
            if (truncated)
                return;
            totalBytes += data.length;
            if (totalBytes > MAX_OUTPUT_BYTES) {
                truncated = true;
                chunks.push(data.subarray(0, MAX_OUTPUT_BYTES - (totalBytes - data.length)));
            }
            else {
                chunks.push(data);
            }
        };
        child.stdout?.on("data", collectOutput);
        child.stderr?.on("data", collectOutput);
        child.on("close", (code) => {
            clearTimeout(timer);
            activeChild = null;
            const durationMs = Date.now() - startTime;
            const raw = Buffer.concat(chunks).toString("utf8").trim();
            const parsed = parseCodexJsonl(raw);
            let text = parsed.text;
            if (truncated)
                text += "\n\n[Output truncated at 100KB]";
            if (!text) {
                text = code === 0
                    ? "Task completed (no output)."
                    : `CLI process exited with code ${code}.`;
            }
            settle({ text, success: parsed.success && code === 0, durationMs });
        });
        child.on("error", (err) => {
            clearTimeout(timer);
            activeChild = null;
            settle({
                text: `CLI launch failed: ${err.message}`,
                success: false,
                durationMs: Date.now() - startTime,
            });
        });
    });
}
// ── Shared: Collect stdout/stderr from a child process ─────
function collectChildOutput(child, startTime) {
    return new Promise((resolve) => {
        const chunks = [];
        let totalBytes = 0;
        let truncated = false;
        let settled = false;
        function settle(result) {
            if (settled)
                return;
            settled = true;
            resolve(result);
        }
        // Timeout with two-stage kill
        const timer = setTimeout(() => {
            closeChild(child);
        }, CLI_TIMEOUT);
        const collectOutput = (data) => {
            if (truncated)
                return;
            totalBytes += data.length;
            if (totalBytes > MAX_OUTPUT_BYTES) {
                truncated = true;
                chunks.push(data.subarray(0, MAX_OUTPUT_BYTES - (totalBytes - data.length)));
            }
            else {
                chunks.push(data);
            }
        };
        child.stdout?.on("data", collectOutput);
        child.stderr?.on("data", collectOutput);
        child.on("close", (code) => {
            clearTimeout(timer);
            activeChild = null;
            const durationMs = Date.now() - startTime;
            let text = Buffer.concat(chunks).toString("utf8").trim();
            if (truncated) {
                text += "\n\n[Output truncated at 100KB]";
            }
            if (!text) {
                text = code === 0
                    ? "Task completed (no output)."
                    : `CLI process exited with code ${code}.`;
            }
            settle({ text, success: code === 0, durationMs });
        });
        child.on("error", (err) => {
            clearTimeout(timer);
            activeChild = null;
            settle({
                text: `CLI launch failed: ${err.message}`,
                success: false,
                durationMs: Date.now() - startTime,
            });
        });
    });
}
// ── Reply ──────────────────────────────────────────────────
export async function postReply(config, promptId, text) {
    try {
        const url = `${config.controlPlaneEndpoint}/v1/credentials/${encodeURIComponent(config.credentialId)}/prompts/${encodeURIComponent(promptId)}/reply`;
        const response = await fetch(url, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "x-zhihand-controller-token": config.controllerToken,
            },
            body: JSON.stringify({ role: "assistant", text }),
            signal: AbortSignal.timeout(30_000),
        });
        // 4xx = prompt cancelled, that's OK
        return response.ok || (response.status >= 400 && response.status < 500);
    }
    catch {
        return false;
    }
}

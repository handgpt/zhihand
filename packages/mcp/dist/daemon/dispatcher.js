import { spawn } from "node:child_process";
import fsp from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { DEFAULT_MODELS } from "../core/config.js";
import { resolveGemini, resolveClaude, resolveCodex } from "../core/resolve-path.js";
import { registry } from "../core/registry.js";
import { dbg } from "./logger.js";
const CLI_TIMEOUT = 300_000; // 300s (5min) per prompt — MCP tool chains need multiple turns
const SIGKILL_DELAY = 2_000; // 2s after SIGTERM
const MCP_PORT = parseInt(process.env.ZHIHAND_PORT ?? "", 10) || 18686;
const MCP_URL = `http://127.0.0.1:${MCP_PORT}/mcp`;
const MAX_OUTPUT_BYTES = 100 * 1024; // 100KB (for one-shot backends)
const MAX_HISTORY_TURNS = 20; // keep last N exchanges in conversation history
// Gemini session file polling
const SESSION_POLL_INTERVAL = 1_000; // 1s
const SESSION_STABILITY_DELAY = 2_000; // wait 2s after outcome before returning
// Resolve pty-wrap.py relative to this file (works from both src/ and dist/)
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PTY_WRAP_SCRIPT = path.resolve(__dirname, "../../scripts/pty-wrap.py");
// Gemini session directories
const GEMINI_TMP_DIR = path.join(os.homedir(), ".gemini", "tmp");
let session = null;
const conversationHistory = [];
// ── Gemini Session File Monitoring ─────────────────────────
/** Safely read and parse a JSON file (single attempt, async). */
async function loadJsonFile(filePath) {
    try {
        const raw = await fsp.readFile(filePath, "utf8");
        const parsed = JSON.parse(raw);
        return typeof parsed === "object" && parsed !== null ? parsed : null;
    }
    catch {
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
    const trailing = [];
    for (let i = messages.length - 1; i >= 0; i--) {
        const msg = messages[i];
        if (String(msg.type ?? "").trim() === "user")
            break;
        trailing.unshift(msg);
    }
    if (trailing.length === 0)
        return null;
    for (const msg of trailing) {
        if (hasActiveToolCalls(msg))
            return null;
    }
    for (let i = trailing.length - 1; i >= 0; i--) {
        const msg = trailing[i];
        const msgType = String(msg.type ?? "").trim();
        if (["error", "warning", "info"].includes(msgType)) {
            const text = extractMessageText(msg).trim();
            if (text)
                return ["error", text];
        }
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
        candidates.sort((a, b) => b.mtime - a.mtime);
        const promptPrefix = promptText.slice(0, 50);
        for (const candidate of candidates) {
            const data = await loadJsonFile(candidate.path);
            if (!data || !Array.isArray(data.messages))
                continue;
            for (const msg of data.messages) {
                if (String(msg.type ?? "").trim() !== "user")
                    continue;
                const text = extractMessageText(msg);
                if (text.startsWith(promptPrefix))
                    return candidate.path;
                break;
            }
        }
        return null;
    }
    catch {
        return null;
    }
}
/** Count how many "user" type messages are in the session */
function countUserMessages(messages) {
    return messages.filter(m => String(m.type ?? "").trim() === "user").length;
}
/**
 * Poll gemini session file for the response to the current prompt.
 *
 * For persistent sessions:
 * - First prompt: find the session file, wait for first response, keep process alive
 * - Subsequent: session file known, wait for new user message + response
 */
function pollGeminiSession(child, startTime, promptText, log, knownSessionFile, expectedUserCount) {
    return new Promise((resolve) => {
        let sessionFile = knownSessionFile;
        let outcomeAt = null;
        let finalResult = null;
        let settled = false;
        let pollTimeout = null;
        let newUserSeen = knownSessionFile === null; // first prompt: don't wait for user msg
        function settle(result) {
            if (settled)
                return;
            settled = true;
            if (pollTimeout)
                clearTimeout(pollTimeout);
            // DON'T kill the child — persistent session keeps it alive
            resolve(result);
        }
        async function poll() {
            if (settled)
                return;
            const elapsed = Date.now() - startTime;
            if (elapsed > CLI_TIMEOUT) {
                // Kill the timed-out session to prevent zombie processes
                if (session?.child === child) {
                    session.alive = false;
                    log(`[gemini] Session timed out — killing process`);
                }
                closeChild(child);
                settle({
                    text: "Gemini timed out after 5 minutes.",
                    success: false,
                    durationMs: elapsed,
                });
                return;
            }
            // Find session file if not yet found (first prompt only)
            if (!sessionFile) {
                sessionFile = await findLatestSessionFile(startTime, promptText);
                if (sessionFile) {
                    log(`[gemini] Session file found: ${path.basename(sessionFile)}`);
                    if (session)
                        session.geminiSessionFile = sessionFile;
                }
                schedulePoll();
                return;
            }
            // Read session file
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
            // For subsequent prompts: wait until the new user message appears
            if (!newUserSeen) {
                const userCount = countUserMessages(messages);
                if (userCount < expectedUserCount) {
                    schedulePoll();
                    return;
                }
                newUserSeen = true;
                log(`[gemini] New user message detected (turn #${expectedUserCount})`);
            }
            const outcome = checkSessionOutcome(messages);
            if (!outcome) {
                outcomeAt = null;
                finalResult = null;
                schedulePoll();
                return;
            }
            if (!outcomeAt) {
                outcomeAt = Date.now();
                finalResult = outcome;
                schedulePoll();
                return;
            }
            if (Date.now() - outcomeAt >= SESSION_STABILITY_DELAY) {
                const [status, text] = finalResult ?? outcome;
                dbg(`[gemini] Session outcome: status=${status}, text (${text.length} chars): ${text.slice(0, 200)}${text.length > 200 ? "..." : ""}`);
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
        schedulePoll();
        // Handle unexpected process exit
        const onClose = (code) => {
            if (settled)
                return;
            // Mark session as dead
            if (session?.child === child) {
                session.alive = false;
                log(`[gemini] Session process exited with code ${code}`);
            }
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
        };
        child.on("close", onClose);
    });
}
/** Gracefully close a child process: SIGTERM → SIGKILL. */
function closeChild(child) {
    if (child.killed || child.exitCode !== null)
        return;
    child.kill("SIGTERM");
    setTimeout(() => {
        if (!child.killed && child.exitCode === null) {
            child.kill("SIGKILL");
        }
    }, SIGKILL_DELAY);
}
/** Close the persistent session and clear conversation history. */
function closeSession() {
    if (!session)
        return Promise.resolve();
    const s = session;
    session = null;
    if (!s.alive)
        return Promise.resolve();
    return new Promise((resolve) => {
        s.child.once("close", () => resolve());
        closeChild(s.child);
        setTimeout(() => resolve(), SIGKILL_DELAY + 1000);
    });
}
/**
 * Kill the active session. Called by daemon on shutdown or backend switch.
 */
export async function killActiveChild() {
    await closeSession();
    conversationHistory.length = 0;
}
// ── System Prompt ─────────────────────────────────────────
/**
 * Build system context dynamically — injects device platform info when available
 * so the AI sends correct platform-specific parameters (e.g. appPackage vs bundleId).
 */
function buildSystemContext() {
    const defaultState = registry.resolveDefault();
    const static_ = defaultState?.profile ?? null;
    const deviceLine = static_
        ? `Connected device: ${static_.platform} ${static_.model} (${static_.osVersion}), ${static_.screenWidthPx}x${static_.screenHeightPx}, ${static_.formFactor}, ${static_.locale}`
        : "Connected device: unknown platform";
    // Platform-specific open_app guidance
    let openAppDoc;
    if (static_?.platform === "android") {
        openAppDoc = "- open_app: Open an app. Params: appPackage (e.g. 'com.tencent.mm'). Do NOT send bundleId or urlScheme on Android.";
    }
    else if (static_?.platform === "ios") {
        openAppDoc = "- open_app: Open an app. Params: bundleId (e.g. 'com.tencent.xin') or urlScheme (e.g. 'weixin://'). Do NOT send appPackage on iOS.";
    }
    else {
        openAppDoc = "- open_app: Open an app. Params: appPackage (Android, e.g. 'com.tencent.mm'), bundleId (iOS), urlScheme (e.g. 'weixin://')";
    }
    // Platform-specific system actions
    let platformSystemDoc;
    if (static_?.platform === "ios") {
        platformSystemDoc = "- siri: Activate Siri\n- control_center: Open Control Center";
    }
    else if (static_?.platform === "android") {
        platformSystemDoc = "- open_browser: Launch default browser\n- shortcut_help: Show keyboard shortcuts overlay";
    }
    else {
        platformSystemDoc = "- siri: Activate Siri (iOS only)\n- control_center: Open Control Center (iOS only)\n- open_browser: Launch default browser (Android only)\n- shortcut_help: Show keyboard shortcuts overlay (Android only)";
    }
    return `You are ZhiHand, an AI assistant connected to the user's mobile phone via MCP tools.

## Device
${deviceLine}

## Available MCP Tools

### zhihand_screenshot
Take a screenshot of the phone screen. Use this when the user asks to see, check, or look at their screen.

### zhihand_control
Control the phone. Requires "action" parameter. All coordinates use normalized ratios [0,1].

**Supported actions:**
- click: Tap at position. Params: xRatio, yRatio
- doubleclick: Double tap. Params: xRatio, yRatio
- longclick: Long press. Params: xRatio, yRatio, durationMs (default 800)
- type: Type text into focused field. Params: text
- swipe: Swipe gesture. Params: startXRatio, startYRatio, endXRatio, endYRatio, durationMs (default 300)
- scroll: Scroll at position. Params: xRatio, yRatio, direction (up/down/left/right), amount (default 3)
- keycombo: Keyboard shortcut. Params: keys (e.g. "ctrl+c", "alt+tab")
- back: Press Back button (no params)
- home: Press Home button (no params)
- enter: Press Enter key (no params)
${openAppDoc}
- clipboard: Set clipboard text. Params: text (the content to copy)
- screenshot: Capture screen via control (same as zhihand_screenshot)
- wait: Wait before next action. Params: durationMs (default 1000)

### zhihand_system
System navigation and media controls. Requires "action" parameter.

**System navigation:**
- notification: Open notification shade/center
- recent: Show app switcher / recent apps
- search: Open system search. Optional "text" param to type query after opening
- switch_input: Switch input method (only works in text input fields)
${platformSystemDoc}

**Media controls:**
- volume_up / volume_down: Adjust volume
- mute: Toggle mute
- play_pause / stop: Playback control
- next_track / prev_track: Skip track
- fast_forward / rewind: Seek

**Hardware:**
- brightness_up / brightness_down: Adjust brightness
- power: Press power button

### zhihand_status
Get device status: platform, battery, network, BLE connection, dark mode, storage, etc.

## Rules
- When the user asks to see their screen, ALWAYS call zhihand_screenshot first.
- When the user asks to open an app (e.g. WeChat, Settings), use open_app action with zhihand_control.
- When the user asks to go back/home, use back/home actions with zhihand_control.
- For system functions (notifications, volume, brightness, media), use zhihand_system.
- For all tap/click operations, use xRatio and yRatio (0-1 normalized coordinates based on the screenshot).`;
}
/**
 * Build the full system prompt with optional conversation history.
 * Used for first prompt in persistent sessions and all one-shot calls.
 */
function wrapPrompt(userPrompt, history) {
    let result = buildSystemContext();
    if (history && history.length > 0) {
        result += "\n\n## Recent Conversation\n";
        for (const turn of history) {
            const label = turn.role === "user" ? "User" : "Assistant";
            // Truncate long assistant responses in history to save tokens
            const text = turn.text.length > 500 ? turn.text.slice(0, 500) + "..." : turn.text;
            result += `\n${label}: ${text}\n`;
        }
    }
    result += `\nUser message:\n${userPrompt}`;
    return result;
}
// ── Conversation History Helpers ─────────────────────────────
function recordTurn(role, text) {
    conversationHistory.push({ role, text });
    // Trim to keep last N exchanges (2 turns per exchange)
    while (conversationHistory.length > MAX_HISTORY_TURNS * 2) {
        conversationHistory.shift();
    }
}
// ── Dispatch Entrypoint ────────────────────────────────────
export function dispatchToCLI(backend, prompt, log, model) {
    const startTime = Date.now();
    const resolvedModel = resolveModel(backend, model);
    // Check if existing session matches — if not, close it
    const canReuse = session?.alive && session.backend === backend && session.model === resolvedModel;
    if (session && !canReuse) {
        log(`[dispatch] Session mismatch (was ${session.backend}/${session.model}), closing old session`);
        closeSession();
        conversationHistory.length = 0;
    }
    const sessionLabel = canReuse ? `#${session.promptCount + 1}` : "new";
    log(`[dispatch] Backend: ${backend}, Model: ${resolvedModel}, Session: ${sessionLabel}`);
    dbg(`[dispatch] Prompt (${prompt.length} chars): ${prompt.slice(0, 200)}${prompt.length > 200 ? "..." : ""}`);
    if (backend === "gemini") {
        return dispatchGeminiPersistent(prompt, startTime, log, resolvedModel);
    }
    if (backend === "codex") {
        return dispatchCodexWithHistory(prompt, startTime, log, resolvedModel);
    }
    if (backend === "claudecode") {
        return dispatchClaudeWithHistory(prompt, startTime, log, resolvedModel);
    }
    return Promise.resolve({
        text: `Unsupported backend: ${backend}`,
        success: false,
        durationMs: 0,
    });
}
/**
 * Resolve the model to use for a backend.
 * Priority: explicit parameter > ZHIHAND_MODEL env > backend-specific env > default alias.
 */
function resolveModel(backend, explicit) {
    if (explicit)
        return explicit;
    const globalEnv = process.env.ZHIHAND_MODEL;
    if (globalEnv)
        return globalEnv;
    const envMap = {
        gemini: process.env.ZHIHAND_GEMINI_MODEL,
        claudecode: process.env.ZHIHAND_CLAUDE_MODEL,
        codex: process.env.ZHIHAND_CODEX_MODEL,
    };
    const perBackend = envMap[backend];
    if (perBackend)
        return perBackend;
    return DEFAULT_MODELS[backend];
}
// ── Gemini Dispatch (Persistent PTY Session) ─────────────────
async function dispatchGeminiPersistent(prompt, startTime, log, model) {
    // Reuse existing session?
    if (session?.alive && session.backend === "gemini") {
        session.promptCount++;
        const turnNum = session.promptCount;
        log(`[gemini] Reusing session — sending prompt #${turnNum}`);
        dbg(`[gemini] Writing to PTY stdin: ${prompt.slice(0, 200)}${prompt.length > 200 ? "..." : ""}`);
        // Write raw prompt to PTY stdin (gemini already has system context from first prompt)
        session.child.stdin?.write(prompt + "\n");
        const result = await pollGeminiSession(session.child, startTime, prompt, log, session.geminiSessionFile, turnNum);
        recordTurn("user", prompt);
        recordTurn("assistant", result.text);
        return result;
    }
    // New session — spawn gemini with first prompt
    const wrappedPrompt = wrapPrompt(prompt);
    const cliArgs = [
        "--approval-mode", "yolo",
        "--model", model,
        "-i", wrappedPrompt,
    ];
    const env = {
        ...process.env,
        GEMINI_SANDBOX: "false",
        TERM: "xterm-256color",
        COLORTERM: "truecolor",
    };
    const geminiPath = resolveGemini();
    log(`[gemini] Starting new persistent session (model: ${model})`);
    dbg(`[gemini] Executable: ${geminiPath}`);
    dbg(`[gemini] PTY wrap: python3 ${PTY_WRAP_SCRIPT}`);
    dbg(`[gemini] Args: ${JSON.stringify(cliArgs)}`);
    dbg(`[gemini] Wrapped prompt (${wrappedPrompt.length} chars): ${wrappedPrompt.slice(0, 300)}...`);
    const child = spawn("python3", [PTY_WRAP_SCRIPT, geminiPath, ...cliArgs], {
        env,
        stdio: ["pipe", "pipe", "pipe"], // stdin=pipe for subsequent prompts
        detached: false,
    });
    session = {
        child,
        backend: "gemini",
        model,
        promptCount: 1,
        alive: true,
        geminiSessionFile: null,
    };
    // Handle unexpected exit — mark session dead
    child.on("close", (code) => {
        if (session?.child === child) {
            session.alive = false;
            log(`[gemini] Session process exited (code ${code})`);
        }
    });
    // Drain PTY stdout/stderr (we read from session file, not stdout)
    child.stdout?.resume();
    child.stderr?.resume();
    const result = await pollGeminiSession(child, startTime, wrappedPrompt, log, null, // no known session file yet
    1);
    recordTurn("user", prompt);
    recordTurn("assistant", result.text);
    return result;
}
// ── Codex Dispatch (One-shot with History) ────────────────────
async function dispatchCodexWithHistory(prompt, startTime, log, model) {
    // Include conversation history in the prompt for context
    const fullPrompt = wrapPrompt(prompt, conversationHistory);
    const args = ["exec", "--dangerously-bypass-approvals-and-sandbox", "--skip-git-repo-check", "--json"];
    args.push("-m", model);
    // Pass prompt via stdin to avoid ARG_MAX limit with long conversation history
    args.push("-");
    const codexPath = resolveCodex();
    log(`[codex] One-shot dispatch (history: ${conversationHistory.length} turns)`);
    dbg(`[codex] Executable: ${codexPath}`);
    dbg(`[codex] Args: ${JSON.stringify(args)}`);
    dbg(`[codex] Stdin prompt (${fullPrompt.length} chars): ${fullPrompt.slice(0, 300)}...`);
    const child = spawn(codexPath, args, {
        env: process.env,
        stdio: ["pipe", "pipe", "pipe"],
        detached: false,
    });
    // Write prompt to stdin, then close to signal EOF
    child.stdin?.write(fullPrompt);
    child.stdin?.end();
    const result = await collectCodexOutput(child, startTime);
    dbg(`[codex] Output: success=${result.success}, duration=${result.durationMs}ms, text (${result.text.length} chars): ${result.text.slice(0, 300)}${result.text.length > 300 ? "..." : ""}`);
    recordTurn("user", prompt);
    recordTurn("assistant", result.text);
    return result;
}
// ── Claude Dispatch (One-shot with History) ───────────────────
async function dispatchClaudeWithHistory(prompt, startTime, log, model) {
    const fullPrompt = wrapPrompt(prompt, conversationHistory);
    const claudePath = resolveClaude();
    log(`[claude] One-shot dispatch (history: ${conversationHistory.length} turns)`);
    // Pass prompt via stdin (-p -) to avoid ARG_MAX limit with long conversation history
    // --permission-mode bypassPermissions: auto-approve all tool calls (like gemini's --approval-mode yolo)
    // --mcp-config: explicitly pass MCP server URL so Claude finds it regardless of cwd
    const mcpConfig = JSON.stringify({ mcpServers: { zhihand: { type: "http", url: MCP_URL } } });
    const claudeArgs = [
        "-p", "-",
        "--model", model,
        "--output-format", "json",
        "--permission-mode", "bypassPermissions",
        "--mcp-config", mcpConfig,
    ];
    dbg(`[claude] Executable: ${claudePath}`);
    dbg(`[claude] Args: ${JSON.stringify(claudeArgs)}`);
    dbg(`[claude] Stdin prompt (${fullPrompt.length} chars): ${fullPrompt.slice(0, 300)}...`);
    const child = spawn(claudePath, claudeArgs, {
        env: process.env,
        stdio: ["pipe", "pipe", "pipe"],
        detached: false,
    });
    // Write prompt to stdin, then close to signal EOF
    child.stdin?.write(fullPrompt);
    child.stdin?.end();
    const raw = await collectChildOutput(child, startTime);
    dbg(`[claude] Raw output (${raw.text.length} chars): ${raw.text.slice(0, 500)}${raw.text.length > 500 ? "..." : ""}`);
    // Claude --output-format json wraps the result in a JSON envelope — extract the actual text
    const result = extractClaudeResult(raw);
    dbg(`[claude] Parsed result: success=${result.success}, text (${result.text.length} chars)`);
    recordTurn("user", prompt);
    recordTurn("assistant", result.text);
    return result;
}
/** Parse Claude JSON output and extract the result text. */
function extractClaudeResult(raw) {
    try {
        const parsed = JSON.parse(raw.text);
        if (!parsed || typeof parsed !== "object")
            return raw;
        const resultText = typeof parsed.result === "string" ? parsed.result : raw.text;
        const isError = parsed.is_error === true || parsed.subtype === "error";
        // Preserve process exit failure: only succeed if both JSON and process agree
        return { text: resultText, success: raw.success && !isError, durationMs: raw.durationMs };
    }
    catch {
        // Not JSON — return as-is
        return raw;
    }
}
// ── Codex JSONL Output Collector ──────────────────────────────
function collectCodexOutput(child, startTime) {
    return new Promise((resolve) => {
        const texts = [];
        let hasError = false;
        let lineBuffer = "";
        let settled = false;
        function settle(result) {
            if (settled)
                return;
            settled = true;
            resolve(result);
        }
        function processLine(line) {
            if (!line.trim())
                return;
            try {
                const event = JSON.parse(line);
                const type = String(event.type ?? "");
                if (type === "item.completed") {
                    const item = event.item;
                    if (item && typeof item.text === "string" && item.text.trim()) {
                        texts.push(item.text.trim());
                    }
                }
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
            catch { /* skip non-JSON */ }
        }
        const timer = setTimeout(() => { closeChild(child); }, CLI_TIMEOUT);
        child.stdout?.on("data", (data) => {
            lineBuffer += data.toString("utf8");
            const lines = lineBuffer.split("\n");
            lineBuffer = lines.pop() ?? "";
            for (const line of lines)
                processLine(line);
        });
        child.stderr?.resume();
        child.on("close", (code) => {
            clearTimeout(timer);
            if (lineBuffer.trim())
                processLine(lineBuffer);
            const durationMs = Date.now() - startTime;
            let text = texts.join("\n\n");
            if (!text) {
                text = code === 0 ? "Task completed (no output)." : `CLI process exited with code ${code}.`;
            }
            settle({ text, success: !hasError && code === 0, durationMs });
        });
        child.on("error", (err) => {
            clearTimeout(timer);
            settle({ text: `CLI launch failed: ${err.message}`, success: false, durationMs: Date.now() - startTime });
        });
    });
}
// ── Shared: Collect stdout/stderr from a child process ───────
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
            const durationMs = Date.now() - startTime;
            let text = Buffer.concat(chunks).toString("utf8").trim();
            if (truncated)
                text += "\n\n[Output truncated at 100KB]";
            if (!text) {
                text = code === 0 ? "Task completed (no output)." : `CLI process exited with code ${code}.`;
            }
            settle({ text, success: code === 0, durationMs });
        });
        child.on("error", (err) => {
            clearTimeout(timer);
            settle({ text: `CLI launch failed: ${err.message}`, success: false, durationMs: Date.now() - startTime });
        });
    });
}
// ── Reply ──────────────────────────────────────────────────
export async function postReply(config, promptId, text) {
    const url = `${config.controlPlaneEndpoint}/v1/credentials/${encodeURIComponent(config.credentialId)}/prompts/${encodeURIComponent(promptId)}/reply`;
    dbg(`[reply] POST ${url}`);
    dbg(`[reply] Body (${text.length} chars): ${text.slice(0, 300)}${text.length > 300 ? "..." : ""}`);
    try {
        const response = await fetch(url, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "x-zhihand-controller-token": config.controllerToken,
            },
            body: JSON.stringify({ role: "assistant", text }),
            signal: AbortSignal.timeout(30_000),
        });
        dbg(`[reply] Response: ${response.status} ${response.statusText}`);
        return response.ok || (response.status >= 400 && response.status < 500);
    }
    catch (err) {
        dbg(`[reply] Error: ${err.message}`);
        return false;
    }
}

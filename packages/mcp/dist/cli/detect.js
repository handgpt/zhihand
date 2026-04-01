import { execSync } from "node:child_process";
function tryExec(cmd) {
    try {
        return execSync(cmd, { encoding: "utf8", timeout: 5000, stdio: ["pipe", "pipe", "pipe"] }).trim();
    }
    catch {
        return null;
    }
}
function isCommandAvailable(cmd) {
    return tryExec(`which ${cmd}`) !== null;
}
async function detectClaudeCode() {
    if (!isCommandAvailable("claude"))
        return null;
    const version = tryExec("claude --version") ?? "unknown";
    // Check login: claude has config in ~/.claude/
    const loggedIn = tryExec("ls ~/.claude/settings.json") !== null;
    return { name: "claudecode", command: "claude", version, loggedIn, priority: 1 };
}
async function detectCodex() {
    if (!isCommandAvailable("codex"))
        return null;
    const version = tryExec("codex --version") ?? "unknown";
    // Check login: OPENAI_API_KEY env var or config
    const loggedIn = !!process.env.OPENAI_API_KEY || tryExec("ls ~/.codex/") !== null;
    return { name: "codex", command: "codex", version, loggedIn, priority: 2 };
}
async function detectGemini() {
    if (!isCommandAvailable("gemini"))
        return null;
    const version = tryExec("gemini --version") ?? "unknown";
    // Check login: Google Cloud auth
    const loggedIn = tryExec("gemini auth status") !== null;
    return { name: "gemini", command: "gemini", version, loggedIn, priority: 3 };
}
async function detectOpenClaw() {
    if (!isCommandAvailable("openclaw"))
        return null;
    const version = tryExec("openclaw --version") ?? "unknown";
    const loggedIn = tryExec("ls ~/.openclaw/openclaw.json") !== null;
    return { name: "openclaw", command: "openclaw", version, loggedIn, priority: 4 };
}
export async function detectCLITools() {
    const results = await Promise.allSettled([
        detectClaudeCode(),
        detectCodex(),
        detectGemini(),
        detectOpenClaw(),
    ]);
    return results
        .filter((r) => r.status === "fulfilled")
        .map((r) => r.value)
        .filter((t) => t !== null)
        .sort((a, b) => a.priority - b.priority);
}
export async function detectBestCLI() {
    const cliOverride = process.env.ZHIHAND_CLI;
    const tools = await detectCLITools();
    if (cliOverride) {
        const match = tools.find((t) => t.name === cliOverride || t.command === cliOverride);
        if (match)
            return match;
    }
    // Return best available tool (logged in + highest priority)
    return tools.find((t) => t.loggedIn) ?? tools[0] ?? null;
}
export function formatDetectedTools(tools) {
    if (tools.length === 0)
        return "No CLI tools detected.";
    return [
        "Detected CLI tools:",
        ...tools.map((t) => `  ${t.loggedIn ? "✓" : "✗"} ${t.name} (${t.command} ${t.version})${t.loggedIn ? "" : " — not logged in"}`),
    ].join("\n");
}

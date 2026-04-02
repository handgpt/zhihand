import { execSync } from "node:child_process";
import { resolveExecutable, resolveGemini, resolveClaude, resolveCodex } from "../core/resolve-path.js";
function tryExec(cmd) {
    try {
        return execSync(cmd, { encoding: "utf8", timeout: 5000, stdio: ["pipe", "pipe", "pipe"] }).trim();
    }
    catch {
        return null;
    }
}
async function detectClaudeCode() {
    const resolved = resolveClaude();
    if (resolved === "claude")
        return null; // bare name = not found
    const version = tryExec(`"${resolved}" --version`) ?? "unknown";
    const loggedIn = tryExec("ls ~/.claude/settings.json") !== null;
    return { name: "claudecode", command: "claude", resolvedPath: resolved, version, loggedIn, priority: 1 };
}
async function detectCodex() {
    const resolved = resolveCodex();
    if (resolved === "codex")
        return null;
    const version = tryExec(`"${resolved}" --version`) ?? "unknown";
    const loggedIn = !!process.env.OPENAI_API_KEY || tryExec("ls ~/.codex/") !== null;
    return { name: "codex", command: "codex", resolvedPath: resolved, version, loggedIn, priority: 2 };
}
async function detectGemini() {
    const resolved = resolveGemini();
    if (resolved === "gemini")
        return null;
    const version = tryExec(`"${resolved}" --version`) ?? "unknown";
    const loggedIn = !!process.env.GOOGLE_API_KEY
        || !!process.env.GEMINI_API_KEY
        || tryExec("ls ~/.gemini/oauth_creds.json") !== null;
    return { name: "gemini", command: "gemini", resolvedPath: resolved, version, loggedIn, priority: 3 };
}
async function detectOpenClaw() {
    const resolved = resolveExecutable("openclaw", []);
    if (resolved === "openclaw")
        return null;
    const version = tryExec(`"${resolved}" --version`) ?? "unknown";
    const loggedIn = tryExec("ls ~/.openclaw/openclaw.json") !== null;
    return { name: "openclaw", command: "openclaw", resolvedPath: resolved, version, loggedIn, priority: 4 };
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

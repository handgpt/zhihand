/**
 * Platform-aware executable path resolution.
 * Shared by both the CLI detection layer and the daemon dispatcher.
 */
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
/** Cache of resolved executable paths to avoid repeated lookups */
const cache = new Map();
/**
 * Resolve an executable by name: first try `which`, then check fallback paths.
 * Supports a single `*` glob segment in fallback paths (for version directories).
 * Returns the full path, or the bare name as last resort.
 */
export function resolveExecutable(name, fallbackPaths) {
    const cached = cache.get(name);
    if (cached)
        return cached;
    // Try `which` first (works when the binary is in PATH)
    try {
        const resolved = execSync(`which ${name}`, { encoding: "utf8", timeout: 5000, stdio: ["pipe", "pipe", "pipe"] }).trim();
        if (resolved) {
            cache.set(name, resolved);
            return resolved;
        }
    }
    catch {
        // Not in PATH, try fallback locations
    }
    for (const candidate of fallbackPaths) {
        if (candidate.includes("*")) {
            // Expand one level of wildcard
            try {
                const parts = candidate.split("*");
                if (parts.length === 2) {
                    const parentDir = parts[0].replace(/\/$/, "");
                    const suffix = parts[1];
                    if (fs.existsSync(parentDir)) {
                        const entries = fs.readdirSync(parentDir, { withFileTypes: true });
                        // Sort descending to prefer latest version
                        const dirs = entries
                            .filter(e => e.isDirectory())
                            .map(e => e.name)
                            .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
                        for (const d of dirs) {
                            const full = parentDir + "/" + d + suffix;
                            if (fs.existsSync(full)) {
                                cache.set(name, full);
                                return full;
                            }
                        }
                    }
                }
            }
            catch { /* skip */ }
        }
        else {
            if (fs.existsSync(candidate)) {
                cache.set(name, candidate);
                return candidate;
            }
        }
    }
    // Last resort: return bare name and let spawn fail with a clear error
    return name;
}
/** Platform-specific fallback paths for gemini */
export function resolveGemini() {
    return resolveExecutable("gemini", [
        "/opt/homebrew/bin/gemini",
        "/usr/local/bin/gemini",
        path.join(os.homedir(), ".local/bin/gemini"),
        path.join(os.homedir(), "bin/gemini"),
    ]);
}
/** Platform-specific fallback paths for claude */
export function resolveClaude() {
    const home = os.homedir();
    const fallbacks = [];
    if (process.platform === "darwin") {
        fallbacks.push(path.join(home, "Library/Application Support/Claude/claude-code/*/claude.app/Contents/MacOS/claude"), "/usr/local/bin/claude", "/opt/homebrew/bin/claude");
    }
    else if (process.platform === "linux") {
        fallbacks.push("/usr/local/bin/claude", path.join(home, ".local/bin/claude"), "/snap/bin/claude");
    }
    else if (process.platform === "win32") {
        fallbacks.push(path.join(process.env.LOCALAPPDATA ?? "", "Programs/Claude/claude.exe"), path.join(process.env.APPDATA ?? "", "npm/claude.cmd"));
    }
    return resolveExecutable("claude", fallbacks);
}
/** Platform-specific fallback paths for codex */
export function resolveCodex() {
    return resolveExecutable("codex", [
        "/opt/homebrew/bin/codex",
        "/usr/local/bin/codex",
        path.join(os.homedir(), ".local/bin/codex"),
    ]);
}

import { execSync } from "node:child_process";
import { resolveClaude, resolveCodex, resolveGemini } from "../core/resolve-path.js";
const DEFAULT_PORT = 18686;
function mcpUrl() {
    const port = parseInt(process.env.ZHIHAND_PORT ?? "", 10) || DEFAULT_PORT;
    return `http://localhost:${port}/mcp`;
}
/** Quote a path for shell execution (handles spaces in paths) */
function q(p) {
    return `"${p}"`;
}
const MCP_COMMANDS = {
    claudecode: {
        add: () => `${q(resolveClaude())} mcp add --transport http zhihand ${mcpUrl()}`,
        remove: () => `${q(resolveClaude())} mcp remove zhihand`,
    },
    codex: {
        add: () => `${q(resolveCodex())} mcp add zhihand --url ${mcpUrl()}`,
        remove: () => `${q(resolveCodex())} mcp remove zhihand`,
    },
    gemini: {
        add: () => `${q(resolveGemini())} mcp add --transport http --scope user zhihand ${mcpUrl()}`,
        remove: () => `${q(resolveGemini())} mcp remove --scope user zhihand`,
    },
};
const DISPLAY_NAMES = {
    claudecode: "Claude Code",
    codex: "Codex CLI",
    gemini: "Gemini CLI",
    openclaw: "OpenClaw",
};
function tryRun(cmd) {
    try {
        execSync(cmd, { stdio: "pipe", timeout: 10_000 });
        return true;
    }
    catch {
        return false;
    }
}
/**
 * Configure MCP (HTTP transport) for the selected backend and remove from others.
 */
export function configureMCP(backend, previousBackend) {
    let removed = false;
    let configured = false;
    // Remove from previous backend if different
    if (previousBackend && previousBackend !== backend && previousBackend !== "openclaw") {
        const cmds = MCP_COMMANDS[previousBackend];
        if (cmds) {
            console.log(`  Removing MCP config from ${DISPLAY_NAMES[previousBackend]}...`);
            removed = tryRun(cmds.remove());
        }
    }
    // Add to new backend
    if (backend === "openclaw") {
        console.log(`  OpenClaw uses plugin system. Run: openclaw plugins install @zhihand/mcp`);
        configured = true;
    }
    else {
        const cmds = MCP_COMMANDS[backend];
        const addCmd = cmds.add();
        console.log(`  Configuring MCP for ${DISPLAY_NAMES[backend]} (HTTP transport)...`);
        try {
            execSync(addCmd, { stdio: "inherit", timeout: 10_000 });
            configured = true;
        }
        catch (err) {
            console.error(`  Failed to configure ${DISPLAY_NAMES[backend]}: ${err.message}`);
        }
    }
    return { configured, removed };
}
export function displayName(backend) {
    return DISPLAY_NAMES[backend];
}

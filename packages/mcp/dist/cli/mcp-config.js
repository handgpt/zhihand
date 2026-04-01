import { execSync } from "node:child_process";
const MCP_COMMANDS = {
    claudecode: {
        add: "claude mcp add zhihand -- zhihand serve",
        remove: "claude mcp remove zhihand",
    },
    codex: {
        add: "codex mcp add zhihand -- zhihand serve",
        remove: "codex mcp remove zhihand",
    },
    gemini: {
        add: "gemini mcp add --scope user zhihand zhihand -- serve",
        remove: "gemini mcp remove --scope user zhihand",
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
 * Configure MCP for the selected backend and remove from others.
 */
export function configureMCP(backend, previousBackend) {
    let removed = false;
    let configured = false;
    // Remove from previous backend if different
    if (previousBackend && previousBackend !== backend && previousBackend !== "openclaw") {
        const cmds = MCP_COMMANDS[previousBackend];
        if (cmds) {
            console.log(`  Removing MCP config from ${DISPLAY_NAMES[previousBackend]}...`);
            removed = tryRun(cmds.remove);
        }
    }
    // Add to new backend
    if (backend === "openclaw") {
        console.log(`  OpenClaw uses plugin system. Run: openclaw plugins install @zhihand/mcp`);
        configured = true;
    }
    else {
        const cmds = MCP_COMMANDS[backend];
        console.log(`  Configuring MCP for ${DISPLAY_NAMES[backend]}...`);
        try {
            execSync(cmds.add, { stdio: "inherit", timeout: 10_000 });
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

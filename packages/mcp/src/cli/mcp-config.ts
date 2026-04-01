import { execSync } from "node:child_process";
import type { BackendName } from "../core/config.ts";

const DEFAULT_PORT = 18686;

function mcpUrl(): string {
  const port = parseInt(process.env.ZHIHAND_PORT ?? "", 10) || DEFAULT_PORT;
  return `http://localhost:${port}/mcp`;
}

interface MCPCommand {
  add: () => string;
  remove: string;
}

const MCP_COMMANDS: Record<Exclude<BackendName, "openclaw">, MCPCommand> = {
  claudecode: {
    add: () => `claude mcp add --transport http zhihand ${mcpUrl()}`,
    remove: "claude mcp remove zhihand",
  },
  codex: {
    add: () => `codex mcp add zhihand --url ${mcpUrl()}`,
    remove: "codex mcp remove zhihand",
  },
  gemini: {
    add: () => `gemini mcp add --transport http --scope user zhihand ${mcpUrl()}`,
    remove: "gemini mcp remove --scope user zhihand",
  },
};

const DISPLAY_NAMES: Record<BackendName, string> = {
  claudecode: "Claude Code",
  codex: "Codex CLI",
  gemini: "Gemini CLI",
  openclaw: "OpenClaw",
};

function tryRun(cmd: string): boolean {
  try {
    execSync(cmd, { stdio: "pipe", timeout: 10_000 });
    return true;
  } catch {
    return false;
  }
}

/**
 * Configure MCP (HTTP transport) for the selected backend and remove from others.
 */
export function configureMCP(
  backend: BackendName,
  previousBackend: BackendName | null,
): { configured: boolean; removed: boolean } {
  let removed = false;
  let configured = false;

  // Remove from previous backend if different
  if (previousBackend && previousBackend !== backend && previousBackend !== "openclaw") {
    const cmds = MCP_COMMANDS[previousBackend as keyof typeof MCP_COMMANDS];
    if (cmds) {
      console.log(`  Removing MCP config from ${DISPLAY_NAMES[previousBackend]}...`);
      removed = tryRun(cmds.remove);
    }
  }

  // Add to new backend
  if (backend === "openclaw") {
    console.log(`  OpenClaw uses plugin system. Run: openclaw plugins install @zhihand/mcp`);
    configured = true;
  } else {
    const cmds = MCP_COMMANDS[backend];
    const addCmd = cmds.add();
    console.log(`  Configuring MCP for ${DISPLAY_NAMES[backend]} (HTTP transport)...`);
    try {
      execSync(addCmd, { stdio: "inherit", timeout: 10_000 });
      configured = true;
    } catch (err: any) {
      console.error(`  Failed to configure ${DISPLAY_NAMES[backend]}: ${err.message}`);
    }
  }

  return { configured, removed };
}

export function displayName(backend: BackendName): string {
  return DISPLAY_NAMES[backend];
}

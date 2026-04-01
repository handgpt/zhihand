import { spawn } from "node:child_process";
import type { CLITool } from "./detect.ts";

export interface SpawnOptions {
  model?: string;
  timeout?: number;
}

/**
 * Spawn a CLI tool interactively, inheriting stdio.
 * Returns the exit code.
 */
export function spawnInteractive(
  command: string,
  args: string[],
  options?: { timeout?: number; env?: Record<string, string> },
): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: "inherit",
      env: { ...process.env, ...options?.env },
    });

    const timer = options?.timeout
      ? setTimeout(() => {
          child.kill("SIGTERM");
          reject(new Error(`Process timed out after ${options.timeout}ms`));
        }, options.timeout)
      : undefined;

    child.on("error", (err) => {
      if (timer) clearTimeout(timer);
      reject(err);
    });

    child.on("close", (code) => {
      if (timer) clearTimeout(timer);
      resolve(code ?? 1);
    });
  });
}

/**
 * Launch a CLI tool with a prompt. For Gemini, uses interactive mode (-i).
 * For others, uses their respective prompt flags.
 */
export async function launchCLI(
  tool: CLITool,
  prompt: string,
  options?: SpawnOptions,
): Promise<number> {
  const timeout = options?.timeout ?? 300_000;

  switch (tool.name) {
    case "claudecode": {
      const args = ["-p", prompt, "--output-format", "json"];
      return spawnInteractive(tool.command, args, { timeout });
    }
    case "codex": {
      const args = ["-q", prompt, "--json"];
      return spawnInteractive(tool.command, args, { timeout });
    }
    case "gemini": {
      const model = options?.model ?? process.env.CLAUDE_GEMINI_MODEL ?? "gemini-3.1-pro-preview";
      const args = [
        "--approval-mode", "yolo",
        "--model", model,
        "-i", prompt,
      ];
      const env: Record<string, string> = {
        GEMINI_SANDBOX: "false",
        TERM: process.env.TERM ?? "xterm-256color",
        COLORTERM: process.env.COLORTERM ?? "truecolor",
      };
      return spawnInteractive(tool.command, args, { timeout, env });
    }
    case "openclaw": {
      const args = ["run", prompt];
      return spawnInteractive(tool.command, args, { timeout });
    }
    default:
      throw new Error(`Unsupported CLI tool: ${tool.name}`);
  }
}

/**
 * Non-interactive spawn that captures output (for MCP-initiated tasks).
 * Uses spawnSync with argument arrays to avoid shell injection.
 */
export function spawnCLITask(tool: CLITool, prompt: string): string {
  const { spawnSync } = require("node:child_process");
  const opts = { encoding: "utf8" as const, timeout: 300_000 };

  let result;
  switch (tool.name) {
    case "claudecode":
      result = spawnSync(tool.command, ["-p", prompt, "--output-format", "json"], opts);
      break;
    case "codex":
      result = spawnSync(tool.command, ["-q", prompt, "--json"], opts);
      break;
    case "gemini":
      result = spawnSync(tool.command, ["--approval-mode", "yolo", "-p", prompt], opts);
      break;
    case "openclaw":
      result = spawnSync(tool.command, ["run", prompt], opts);
      break;
    default:
      throw new Error(`Unsupported CLI tool: ${tool.name}`);
  }

  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(result.stderr || `Process exited with code ${result.status}`);
  return result.stdout;
}

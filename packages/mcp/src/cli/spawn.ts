import { execSync } from "node:child_process";
import type { CLITool } from "./detect.ts";

function shellEscape(s: string): string {
  return `'${s.replace(/'/g, "'\\''")}'`;
}

export async function spawnCLITask(tool: CLITool, prompt: string): Promise<string> {
  const escaped = shellEscape(prompt);
  switch (tool.name) {
    case "claudecode":
      return execSync(`${tool.command} -p ${escaped} --output-format json`, {
        encoding: "utf8",
        timeout: 300_000,
      });
    case "codex":
      return execSync(`${tool.command} -q ${escaped} --json`, {
        encoding: "utf8",
        timeout: 300_000,
      });
    case "gemini":
      return execSync(`${tool.command} -p ${escaped}`, {
        encoding: "utf8",
        timeout: 300_000,
      });
    case "openclaw":
      return execSync(`${tool.command} run ${escaped}`, {
        encoding: "utf8",
        timeout: 300_000,
      });
    default:
      throw new Error(`Unsupported CLI tool: ${tool.name}`);
  }
}

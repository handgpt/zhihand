import { execSync } from "node:child_process";

function tryExec(cmd: string): string | null {
  try {
    return execSync(cmd, { encoding: "utf8", timeout: 30_000, stdio: ["pipe", "pipe", "pipe"] }).trim();
  } catch {
    return null;
  }
}

function isCommandAvailable(cmd: string): boolean {
  return tryExec(`which ${cmd}`) !== null;
}

export async function isZhiHandPluginInstalled(): Promise<boolean> {
  const output = tryExec("openclaw plugins list");
  if (!output) return false;
  return output.includes("zhihand") || output.includes("@zhihand/mcp");
}

export async function installZhiHandPlugin(
  options: { timeoutMs?: number; autoConfirm?: boolean } = {}
): Promise<boolean> {
  const timeout = options.timeoutMs ?? 30_000;
  try {
    execSync("openclaw plugins install @zhihand/mcp", {
      encoding: "utf8",
      timeout,
      stdio: options.autoConfirm ? ["pipe", "pipe", "pipe"] : "inherit",
    });
    return true;
  } catch {
    return false;
  }
}

export async function detectAndSetupOpenClaw(): Promise<void> {
  if (!isCommandAvailable("openclaw")) return;

  const pluginInstalled = await isZhiHandPluginInstalled();
  if (pluginInstalled) return;

  process.stderr.write("[zhihand] Detected OpenClaw without ZhiHand plugin. Installing...\n");
  const success = await installZhiHandPlugin({ timeoutMs: 30_000, autoConfirm: true });
  if (success) {
    process.stderr.write("[zhihand] ZhiHand plugin installed to OpenClaw.\n");
  } else {
    process.stderr.write("[zhihand] Failed to install ZhiHand plugin to OpenClaw.\n");
  }
}

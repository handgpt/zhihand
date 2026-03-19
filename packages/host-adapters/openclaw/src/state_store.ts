import fs from "node:fs/promises";
import path from "node:path";
import { randomInt } from "node:crypto";

import type { PluginRecord } from "./index.ts";

export type StoredPairingState = {
  sessionId: string;
  controllerToken: string;
  edgeId: string;
  edgeHost: string;
  pairUrl: string;
  qrPayload: string;
  credentialId?: string;
  status: string;
  expiresAt: string;
};

export type StoredPluginState = {
  plugin?: PluginRecord;
  pairing?: StoredPairingState;
  update?: {
    lastCheckedAt?: string;
    latestVersion?: string;
    lastError?: string;
    pendingRestartVersion?: string;
    lastInstalledAt?: string;
  };
};

const STATE_RELATIVE_PATH = ["plugins", "openclaw", "state.json"] as const;

export async function loadState(stateDir: string): Promise<StoredPluginState> {
  const filePath = resolveStatePath(stateDir);
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw) as StoredPluginState;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return {};
    }
    throw error;
  }
}

export async function saveState(stateDir: string, state: StoredPluginState): Promise<void> {
  const filePath = resolveStatePath(stateDir);
  const tempPath = `${filePath}.tmp-${process.pid}-${randomInt(1_000_000)}`;
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(tempPath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  await fs.rename(tempPath, filePath);
}

export function resolveStatePath(stateDir: string): string {
  return path.join(stateDir, ...STATE_RELATIVE_PATH);
}

import fs from "node:fs/promises";
import path from "node:path";
import { randomInt } from "node:crypto";

import type { PluginRecord } from "./index.ts";
import {
  LEGACY_ZHIHAND_PLUGIN_ID,
  ZHIHAND_PLUGIN_ID
} from "./plugin_identity.ts";

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

const CURRENT_STATE_RELATIVE_PATH = ["plugins", ZHIHAND_PLUGIN_ID, "state.json"] as const;
const LEGACY_STATE_RELATIVE_PATH = ["plugins", LEGACY_ZHIHAND_PLUGIN_ID, "state.json"] as const;

export async function loadState(stateDir: string): Promise<StoredPluginState> {
  try {
    const raw = await fs.readFile(resolveStatePath(stateDir), "utf8");
    return JSON.parse(raw) as StoredPluginState;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
  }

  try {
    const raw = await fs.readFile(resolveLegacyStatePath(stateDir), "utf8");
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
  return path.join(stateDir, ...CURRENT_STATE_RELATIVE_PATH);
}

export function resolveLegacyStatePath(stateDir: string): string {
  return path.join(stateDir, ...LEGACY_STATE_RELATIVE_PATH);
}

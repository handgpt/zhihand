import fs from "node:fs";
import path from "node:path";
import os from "node:os";

// ── Types ──────────────────────────────────────────────────

export type DevicePlatform = "ios" | "android" | "unknown";

export interface DeviceRecord {
  credential_id: string;
  label: string;
  platform: DevicePlatform;
  paired_at: string;
  last_seen_at: string;
}

export interface UserRecord {
  user_id: string;
  controller_token: string;
  label: string;
  created_at: string;
  devices: DeviceRecord[];
}

export interface ZhihandConfigV3 {
  schema_version: 3;
  users: Record<string, UserRecord>;
}

/**
 * Runtime config passed to HTTP callers (command/sse/device endpoints).
 * Derived from a UserRecord + DeviceRecord pair.
 */
export interface ZhiHandRuntimeConfig {
  controlPlaneEndpoint: string;
  credentialId: string;
  controllerToken: string;
  edgeId?: string;
  timeoutMs?: number;
}

export type BackendName = "claudecode" | "codex" | "gemini" | "openclaw";

export interface BackendConfig {
  activeBackend: BackendName | null;
  model?: string | null;
}

export const DEFAULT_MODELS: Record<Exclude<BackendName, "openclaw">, string> = {
  gemini: "flash",
  claudecode: "sonnet",
  codex: "gpt-5.4-mini",
};

// ── Paths ──────────────────────────────────────────────────

const ZHIHAND_DIR = path.join(os.homedir(), ".zhihand");
const CONFIG_PATH = path.join(ZHIHAND_DIR, "config.json");
const STATE_PATH = path.join(ZHIHAND_DIR, "state.json");
const BACKEND_PATH = path.join(ZHIHAND_DIR, "backend.json");

export function resolveZhiHandDir(): string {
  return ZHIHAND_DIR;
}

export function ensureZhiHandDir(): void {
  fs.mkdirSync(ZHIHAND_DIR, { recursive: true, mode: 0o700 });
}

export function getConfigPath(): string {
  return CONFIG_PATH;
}

// ── v3 config I/O ──────────────────────────────────────────

let legacyWarningPrinted = false;

function emptyConfig(): ZhihandConfigV3 {
  return { schema_version: 3, users: {} };
}

export function loadConfig(): ZhihandConfigV3 {
  if (!fs.existsSync(CONFIG_PATH)) {
    // Check for v2 or legacy credentials
    const legacyCredentials = path.join(ZHIHAND_DIR, "credentials.json");
    if (!legacyWarningPrinted && (fs.existsSync(legacyCredentials) || checkForV2Config())) {
      legacyWarningPrinted = true;
      process.stderr.write(
        "[zhihand] old config detected (v2 or legacy) — run 'zhihand pair' to re-pair on v0.31 schema\n",
      );
    }
    return emptyConfig();
  }
  try {
    const raw = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
    if (raw && raw.schema_version === 3) {
      return {
        schema_version: 3,
        users: raw.users ?? {},
      };
    }
    // Old schema version detected
    if (!legacyWarningPrinted) {
      legacyWarningPrinted = true;
      process.stderr.write(
        "[zhihand] old config detected (schema v" + (raw.schema_version ?? "?") + ") — run 'zhihand pair' to re-pair on v0.31 schema\n",
      );
    }
  } catch {
    // fall through
  }
  return emptyConfig();
}

function checkForV2Config(): boolean {
  if (!fs.existsSync(CONFIG_PATH)) return false;
  try {
    const raw = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
    return raw && raw.schema_version === 2;
  } catch {
    return false;
  }
}

/**
 * Atomically write config: write to .tmp, then rename. Prevents corruption
 * when the daemon and CLI write concurrently (Gemini code review v0.31).
 */
export function saveConfig(cfg: ZhihandConfigV3): void {
  ensureZhiHandDir();
  const tmpPath = CONFIG_PATH + ".tmp";
  fs.writeFileSync(tmpPath, JSON.stringify(cfg, null, 2), { mode: 0o600 });
  fs.renameSync(tmpPath, CONFIG_PATH);
}

// ── User helpers ──────────────────────────────────────────

export function addUser(user: UserRecord): void {
  const cfg = loadConfig();
  cfg.users[user.user_id] = user;
  saveConfig(cfg);
}

export function removeUser(userId: string): void {
  const cfg = loadConfig();
  delete cfg.users[userId];
  saveConfig(cfg);
}

export function addDeviceToUser(userId: string, device: DeviceRecord): void {
  const cfg = loadConfig();
  const user = cfg.users[userId];
  if (!user) throw new Error(`User '${userId}' not found in config`);
  // Replace if exists, else append
  const idx = user.devices.findIndex((d) => d.credential_id === device.credential_id);
  if (idx >= 0) {
    user.devices[idx] = device;
  } else {
    user.devices.push(device);
  }
  saveConfig(cfg);
}

export function removeDeviceFromUser(userId: string, credentialId: string): void {
  const cfg = loadConfig();
  const user = cfg.users[userId];
  if (!user) return;
  user.devices = user.devices.filter((d) => d.credential_id !== credentialId);
  saveConfig(cfg);
}

export function updateDeviceLabel(userId: string, credentialId: string, label: string): void {
  const cfg = loadConfig();
  const user = cfg.users[userId];
  if (!user) throw new Error(`User '${userId}' not found`);
  const dev = user.devices.find((d) => d.credential_id === credentialId);
  if (!dev) throw new Error(`Device '${credentialId}' not found under user '${userId}'`);
  dev.label = label;
  saveConfig(cfg);
}

export function updateControllerToken(userId: string, newToken: string): void {
  const cfg = loadConfig();
  const user = cfg.users[userId];
  if (!user) throw new Error(`User '${userId}' not found`);
  user.controller_token = newToken;
  saveConfig(cfg);
}

export function updateDeviceLastSeen(userId: string, credentialId: string, iso: string): void {
  const cfg = loadConfig();
  const user = cfg.users[userId];
  if (!user) return;
  const dev = user.devices.find((d) => d.credential_id === credentialId);
  if (!dev) return;
  dev.last_seen_at = iso;
  saveConfig(cfg);
}

export function getUserRecord(userId: string): UserRecord | null {
  const cfg = loadConfig();
  return cfg.users[userId] ?? null;
}

export function findDeviceOwner(credentialId: string): { user: UserRecord; device: DeviceRecord } | null {
  const cfg = loadConfig();
  for (const user of Object.values(cfg.users)) {
    const device = user.devices.find((d) => d.credential_id === credentialId);
    if (device) return { user, device };
  }
  return null;
}

export function listUsers(): UserRecord[] {
  const cfg = loadConfig();
  return Object.values(cfg.users);
}

// ── Runtime config resolution ─────────────────────────────

export function resolveDefaultEndpoint(): string {
  return process.env.ZHIHAND_ENDPOINT ?? "https://api.zhihand.com";
}

/**
 * Resolve a runtime config for HTTP calls. Find which user owns the
 * credential and use the user's controller_token.
 */
export function resolveConfig(credentialId?: string): ZhiHandRuntimeConfig {
  const cfg = loadConfig();
  const endpoint = resolveDefaultEndpoint();

  if (credentialId) {
    const owner = findDeviceOwner(credentialId);
    if (!owner) {
      const known = Object.values(cfg.users)
        .flatMap((u) => u.devices.map((d) => d.credential_id))
        .join(", ") || "(none)";
      throw new Error(`Device '${credentialId}' not found. Known: ${known}`);
    }
    return {
      controlPlaneEndpoint: endpoint,
      credentialId,
      controllerToken: owner.user.controller_token,
      timeoutMs: 10_000,
    };
  }

  // No explicit credential — pick first device of first user
  const users = Object.values(cfg.users);
  if (users.length === 0) {
    throw new Error("No users configured — run zhihand pair");
  }
  for (const user of users) {
    if (user.devices.length > 0) {
      return {
        controlPlaneEndpoint: endpoint,
        credentialId: user.devices[0]!.credential_id,
        controllerToken: user.controller_token,
        timeoutMs: 10_000,
      };
    }
  }
  throw new Error("No devices configured — run zhihand pair");
}

// ── State / backend ───────────────────────────────────────

export function loadState<T = unknown>(): T | null {
  if (!fs.existsSync(STATE_PATH)) return null;
  try {
    return JSON.parse(fs.readFileSync(STATE_PATH, "utf8")) as T;
  } catch {
    return null;
  }
}

export function saveState(state: unknown): void {
  ensureZhiHandDir();
  fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
}

export function loadBackendConfig(): BackendConfig {
  if (!fs.existsSync(BACKEND_PATH)) return { activeBackend: null };
  try {
    return JSON.parse(fs.readFileSync(BACKEND_PATH, "utf8")) as BackendConfig;
  } catch {
    return { activeBackend: null };
  }
}

export function saveBackendConfig(config: BackendConfig): void {
  ensureZhiHandDir();
  fs.writeFileSync(BACKEND_PATH, JSON.stringify(config, null, 2));
}

import fs from "node:fs";
import path from "node:path";
import os from "node:os";

// ── Types ──────────────────────────────────────────────────

export type DevicePlatform = "ios" | "android" | "unknown";

export interface DeviceRecord {
  credential_id: string;
  controller_token: string;
  endpoint: string;
  label: string;
  platform: DevicePlatform;
  paired_at: string;
  last_seen_at: string;
}

export interface ZhihandConfig {
  schema_version: 2;
  default_credential_id: string | null;
  devices: Record<string, DeviceRecord>;
}

/**
 * Legacy-shaped config passed to HTTP callers (command/sse/device endpoints).
 * Corresponds to what the old single-device code called ZhiHandConfig.
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
const LEGACY_CREDENTIALS_PATH = path.join(ZHIHAND_DIR, "credentials.json");
const STATE_PATH = path.join(ZHIHAND_DIR, "state.json");
const BACKEND_PATH = path.join(ZHIHAND_DIR, "backend.json");

export function resolveZhiHandDir(): string {
  return ZHIHAND_DIR;
}

export function ensureZhiHandDir(): void {
  fs.mkdirSync(ZHIHAND_DIR, { recursive: true, mode: 0o700 });
}

// ── v2 config I/O ──────────────────────────────────────────

let legacyWarningPrinted = false;

function emptyConfig(): ZhihandConfig {
  return { schema_version: 2, default_credential_id: null, devices: {} };
}

export function loadConfig(): ZhihandConfig {
  if (!fs.existsSync(CONFIG_PATH)) {
    if (!legacyWarningPrinted && fs.existsSync(LEGACY_CREDENTIALS_PATH)) {
      legacyWarningPrinted = true;
      process.stderr.write(
        "[zhihand] legacy credentials.json detected — run 'zhihand pair' to re-pair on v0.30 schema\n",
      );
    }
    return emptyConfig();
  }
  try {
    const raw = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8")) as Partial<ZhihandConfig>;
    if (raw && raw.schema_version === 2) {
      return {
        schema_version: 2,
        default_credential_id: raw.default_credential_id ?? null,
        devices: raw.devices ?? {},
      };
    }
  } catch {
    // fall through
  }
  return emptyConfig();
}

export function saveConfig(cfg: ZhihandConfig): void {
  ensureZhiHandDir();
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2), { mode: 0o600 });
}

export function addDevice(record: DeviceRecord, makeDefault?: boolean): void {
  const cfg = loadConfig();
  cfg.devices[record.credential_id] = record;
  if (makeDefault || cfg.default_credential_id === null) {
    cfg.default_credential_id = record.credential_id;
  }
  saveConfig(cfg);
}

export function removeDevice(credentialId: string): void {
  const cfg = loadConfig();
  delete cfg.devices[credentialId];
  if (cfg.default_credential_id === credentialId) {
    const remaining = Object.keys(cfg.devices);
    cfg.default_credential_id = remaining[0] ?? null;
  }
  saveConfig(cfg);
}

export function renameDevice(credentialId: string, label: string): void {
  const cfg = loadConfig();
  const r = cfg.devices[credentialId];
  if (!r) throw new Error(`Device '${credentialId}' not found`);
  r.label = label;
  saveConfig(cfg);
}

export function setDefaultDevice(credentialId: string): void {
  const cfg = loadConfig();
  if (!cfg.devices[credentialId]) {
    throw new Error(`Device '${credentialId}' not found`);
  }
  cfg.default_credential_id = credentialId;
  saveConfig(cfg);
}

export function updateLastSeen(credentialId: string, iso: string): void {
  const cfg = loadConfig();
  const r = cfg.devices[credentialId];
  if (!r) return;
  r.last_seen_at = iso;
  saveConfig(cfg);
}

export function getDeviceRecord(credentialId: string): DeviceRecord | null {
  const cfg = loadConfig();
  return cfg.devices[credentialId] ?? null;
}

export function listDeviceRecords(): DeviceRecord[] {
  const cfg = loadConfig();
  return Object.values(cfg.devices);
}

// ── Runtime config resolution ─────────────────────────────

export function recordToRuntimeConfig(r: DeviceRecord): ZhiHandRuntimeConfig {
  return {
    controlPlaneEndpoint: r.endpoint,
    credentialId: r.credential_id,
    controllerToken: r.controller_token,
    timeoutMs: 10_000,
  };
}

/**
 * Resolve a runtime config for HTTP calls. If credentialId provided, look it up;
 * else use default_credential_id; else throw.
 */
export function resolveConfig(credentialId?: string): ZhiHandRuntimeConfig {
  const cfg = loadConfig();
  const id = credentialId ?? cfg.default_credential_id;
  if (!id) {
    throw new Error("No default device — run zhihand pair");
  }
  const r = cfg.devices[id];
  if (!r) {
    const known = Object.keys(cfg.devices).join(", ") || "(none)";
    throw new Error(`Device '${id}' not found. Known: ${known}`);
  }
  return recordToRuntimeConfig(r);
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

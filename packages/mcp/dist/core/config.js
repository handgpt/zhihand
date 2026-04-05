import fs from "node:fs";
import path from "node:path";
import os from "node:os";
export const DEFAULT_MODELS = {
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
export function resolveZhiHandDir() {
    return ZHIHAND_DIR;
}
export function ensureZhiHandDir() {
    fs.mkdirSync(ZHIHAND_DIR, { recursive: true, mode: 0o700 });
}
// ── v2 config I/O ──────────────────────────────────────────
let legacyWarningPrinted = false;
function emptyConfig() {
    return { schema_version: 2, default_credential_id: null, devices: {} };
}
export function loadConfig() {
    if (!fs.existsSync(CONFIG_PATH)) {
        if (!legacyWarningPrinted && fs.existsSync(LEGACY_CREDENTIALS_PATH)) {
            legacyWarningPrinted = true;
            process.stderr.write("[zhihand] legacy credentials.json detected — run 'zhihand pair' to re-pair on v0.30 schema\n");
        }
        return emptyConfig();
    }
    try {
        const raw = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
        if (raw && raw.schema_version === 2) {
            return {
                schema_version: 2,
                default_credential_id: raw.default_credential_id ?? null,
                devices: raw.devices ?? {},
            };
        }
    }
    catch {
        // fall through
    }
    return emptyConfig();
}
export function saveConfig(cfg) {
    ensureZhiHandDir();
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2), { mode: 0o600 });
}
export function addDevice(record, makeDefault) {
    const cfg = loadConfig();
    cfg.devices[record.credential_id] = record;
    if (makeDefault || cfg.default_credential_id === null) {
        cfg.default_credential_id = record.credential_id;
    }
    saveConfig(cfg);
}
export function removeDevice(credentialId) {
    const cfg = loadConfig();
    delete cfg.devices[credentialId];
    if (cfg.default_credential_id === credentialId) {
        const remaining = Object.keys(cfg.devices);
        cfg.default_credential_id = remaining[0] ?? null;
    }
    saveConfig(cfg);
}
export function renameDevice(credentialId, label) {
    const cfg = loadConfig();
    const r = cfg.devices[credentialId];
    if (!r)
        throw new Error(`Device '${credentialId}' not found`);
    r.label = label;
    saveConfig(cfg);
}
export function setDefaultDevice(credentialId) {
    const cfg = loadConfig();
    if (!cfg.devices[credentialId]) {
        throw new Error(`Device '${credentialId}' not found`);
    }
    cfg.default_credential_id = credentialId;
    saveConfig(cfg);
}
export function updateLastSeen(credentialId, iso) {
    const cfg = loadConfig();
    const r = cfg.devices[credentialId];
    if (!r)
        return;
    r.last_seen_at = iso;
    saveConfig(cfg);
}
export function getDeviceRecord(credentialId) {
    const cfg = loadConfig();
    return cfg.devices[credentialId] ?? null;
}
export function listDeviceRecords() {
    const cfg = loadConfig();
    return Object.values(cfg.devices);
}
// ── Runtime config resolution ─────────────────────────────
export function recordToRuntimeConfig(r) {
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
export function resolveConfig(credentialId) {
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
export function loadState() {
    if (!fs.existsSync(STATE_PATH))
        return null;
    try {
        return JSON.parse(fs.readFileSync(STATE_PATH, "utf8"));
    }
    catch {
        return null;
    }
}
export function saveState(state) {
    ensureZhiHandDir();
    fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
}
export function loadBackendConfig() {
    if (!fs.existsSync(BACKEND_PATH))
        return { activeBackend: null };
    try {
        return JSON.parse(fs.readFileSync(BACKEND_PATH, "utf8"));
    }
    catch {
        return { activeBackend: null };
    }
}
export function saveBackendConfig(config) {
    ensureZhiHandDir();
    fs.writeFileSync(BACKEND_PATH, JSON.stringify(config, null, 2));
}

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
const STATE_PATH = path.join(ZHIHAND_DIR, "state.json");
const BACKEND_PATH = path.join(ZHIHAND_DIR, "backend.json");
const IDENTITY_PATH = path.join(ZHIHAND_DIR, "identity.json");
export function resolveZhiHandDir() {
    return ZHIHAND_DIR;
}
export function ensureZhiHandDir() {
    fs.mkdirSync(ZHIHAND_DIR, { recursive: true, mode: 0o700 });
}
export function getConfigPath() {
    return CONFIG_PATH;
}
// ── Plugin identity I/O ──────────────────────────────────
/** Read persisted Plugin identity. Returns null if missing or malformed. */
export function loadPluginIdentity() {
    try {
        const raw = JSON.parse(fs.readFileSync(IDENTITY_PATH, "utf-8"));
        if (raw.stable_identity && raw.edge_id && raw.plugin_secret) {
            return raw;
        }
        return null;
    }
    catch {
        return null;
    }
}
/** Atomically persist Plugin identity (write-to-tmp + rename, mode 0o600). */
export function savePluginIdentity(identity) {
    ensureZhiHandDir();
    const tmp = IDENTITY_PATH + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(identity, null, 2), { mode: 0o600 });
    fs.renameSync(tmp, IDENTITY_PATH);
}
/** Delete identity.json (used by `zhihand identity reset`). */
export function clearPluginIdentity() {
    try {
        fs.unlinkSync(IDENTITY_PATH);
    }
    catch {
        // already gone
    }
}
// ── v3 config I/O ──────────────────────────────────────────
let legacyWarningPrinted = false;
function emptyConfig() {
    return { schema_version: 3, users: {} };
}
export function loadConfig() {
    if (!fs.existsSync(CONFIG_PATH)) {
        // Check for legacy credentials.json (pre-v3)
        const legacyCredentials = path.join(ZHIHAND_DIR, "credentials.json");
        if (!legacyWarningPrinted && fs.existsSync(legacyCredentials)) {
            legacyWarningPrinted = true;
            process.stderr.write("[zhihand] old config detected (legacy credentials) — run 'zhihand pair' to re-pair on v0.31 schema\n");
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
        // Old schema version (v2 or unknown) in config.json
        if (!legacyWarningPrinted) {
            legacyWarningPrinted = true;
            process.stderr.write("[zhihand] old config detected (schema v" + (raw.schema_version ?? "?") + ") — run 'zhihand pair' to re-pair on v0.31 schema\n");
        }
    }
    catch {
        // fall through
    }
    return emptyConfig();
}
/**
 * Atomically write config: write to .tmp, then rename. Prevents corruption
 * when the daemon and CLI write concurrently (Gemini code review v0.31).
 */
export function saveConfig(cfg) {
    ensureZhiHandDir();
    const tmpPath = CONFIG_PATH + ".tmp";
    fs.writeFileSync(tmpPath, JSON.stringify(cfg, null, 2), { mode: 0o600 });
    fs.renameSync(tmpPath, CONFIG_PATH);
}
/**
 * Clean up legacy config files (v2 schema, credentials.json) before re-pairing.
 * Replaces old config with empty v3 so loadConfig() won't warn.
 */
export function cleanupLegacyConfig() {
    const legacyCredentials = path.join(ZHIHAND_DIR, "credentials.json");
    if (fs.existsSync(legacyCredentials)) {
        fs.unlinkSync(legacyCredentials);
    }
    if (fs.existsSync(CONFIG_PATH)) {
        try {
            const raw = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
            if (!raw || raw.schema_version !== 3) {
                saveConfig(emptyConfig());
            }
        }
        catch {
            saveConfig(emptyConfig());
        }
    }
}
// ── User helpers ──────────────────────────────────────────
export function addUser(user) {
    const cfg = loadConfig();
    cfg.users[user.user_id] = user;
    saveConfig(cfg);
}
export function removeUser(userId) {
    const cfg = loadConfig();
    delete cfg.users[userId];
    saveConfig(cfg);
}
export function addDeviceToUser(userId, device) {
    const cfg = loadConfig();
    const user = cfg.users[userId];
    if (!user)
        throw new Error(`User '${userId}' not found in config`);
    // Replace if exists, else append
    const idx = user.devices.findIndex((d) => d.credential_id === device.credential_id);
    if (idx >= 0) {
        user.devices[idx] = device;
    }
    else {
        user.devices.push(device);
    }
    saveConfig(cfg);
}
export function removeDeviceFromUser(userId, credentialId) {
    const cfg = loadConfig();
    const user = cfg.users[userId];
    if (!user)
        return;
    user.devices = user.devices.filter((d) => d.credential_id !== credentialId);
    saveConfig(cfg);
}
export function updateDeviceLabel(userId, credentialId, label) {
    const cfg = loadConfig();
    const user = cfg.users[userId];
    if (!user)
        throw new Error(`User '${userId}' not found`);
    const dev = user.devices.find((d) => d.credential_id === credentialId);
    if (!dev)
        throw new Error(`Device '${credentialId}' not found under user '${userId}'`);
    dev.label = label;
    saveConfig(cfg);
}
export function updateControllerToken(userId, newToken) {
    const cfg = loadConfig();
    const user = cfg.users[userId];
    if (!user)
        throw new Error(`User '${userId}' not found`);
    user.controller_token = newToken;
    saveConfig(cfg);
}
export function updateDeviceLastSeen(userId, credentialId, iso) {
    const cfg = loadConfig();
    const user = cfg.users[userId];
    if (!user)
        return;
    const dev = user.devices.find((d) => d.credential_id === credentialId);
    if (!dev)
        return;
    dev.last_seen_at = iso;
    saveConfig(cfg);
}
export function getUserRecord(userId) {
    const cfg = loadConfig();
    return cfg.users[userId] ?? null;
}
export function findDeviceOwner(credentialId) {
    const cfg = loadConfig();
    for (const user of Object.values(cfg.users)) {
        const device = user.devices.find((d) => d.credential_id === credentialId);
        if (device)
            return { user, device };
    }
    return null;
}
export function listUsers() {
    const cfg = loadConfig();
    return Object.values(cfg.users);
}
// ── Runtime config resolution ─────────────────────────────
export function resolveDefaultEndpoint() {
    return process.env.ZHIHAND_ENDPOINT ?? "https://api.zhihand.com";
}
/**
 * Resolve a runtime config for HTTP calls. Find which user owns the
 * credential and use the user's controller_token.
 */
export function resolveConfig(credentialId) {
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
                credentialId: user.devices[0].credential_id,
                controllerToken: user.controller_token,
                timeoutMs: 10_000,
            };
        }
    }
    throw new Error("No devices configured — run zhihand pair");
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

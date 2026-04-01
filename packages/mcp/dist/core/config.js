import fs from "node:fs";
import path from "node:path";
import os from "node:os";
const ZHIHAND_DIR = path.join(os.homedir(), ".zhihand");
const CREDENTIALS_PATH = path.join(ZHIHAND_DIR, "credentials.json");
const STATE_PATH = path.join(ZHIHAND_DIR, "state.json");
const BACKEND_PATH = path.join(ZHIHAND_DIR, "backend.json");
export function resolveZhiHandDir() {
    return ZHIHAND_DIR;
}
export function ensureZhiHandDir() {
    fs.mkdirSync(ZHIHAND_DIR, { recursive: true, mode: 0o700 });
}
export function loadCredentialStore() {
    if (!fs.existsSync(CREDENTIALS_PATH))
        return null;
    try {
        return JSON.parse(fs.readFileSync(CREDENTIALS_PATH, "utf8"));
    }
    catch {
        return null;
    }
}
export function loadDefaultCredential() {
    const store = loadCredentialStore();
    if (!store)
        return null;
    return store.devices[store.default] ?? null;
}
export function saveCredential(name, cred, setDefault = true) {
    ensureZhiHandDir();
    let store = loadCredentialStore() ?? { default: name, devices: {} };
    store.devices[name] = cred;
    if (setDefault)
        store.default = name;
    fs.writeFileSync(CREDENTIALS_PATH, JSON.stringify(store, null, 2), { mode: 0o600 });
}
export function resolveConfig(deviceName) {
    const store = loadCredentialStore();
    if (!store) {
        throw new Error("No ZhiHand credentials found. Run 'zhihand pair' first.");
    }
    const name = deviceName ?? store.default;
    const cred = store.devices[name];
    if (!cred) {
        throw new Error(`Device '${name}' not found. Available: ${Object.keys(store.devices).join(", ")}`);
    }
    return {
        controlPlaneEndpoint: cred.endpoint,
        credentialId: cred.credentialId,
        controllerToken: cred.controllerToken,
        timeoutMs: 10_000,
    };
}
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

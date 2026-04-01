import fs from "node:fs";
import path from "node:path";
import os from "node:os";

export interface DeviceCredential {
  credentialId: string;
  controllerToken: string;
  endpoint: string;
  deviceName?: string;
  pairedAt?: string;
}

export interface CredentialStore {
  default: string;
  devices: Record<string, DeviceCredential>;
}

export interface ZhiHandConfig {
  controlPlaneEndpoint: string;
  credentialId: string;
  controllerToken: string;
  edgeId?: string;
  timeoutMs?: number;
}

const ZHIHAND_DIR = path.join(os.homedir(), ".zhihand");
const CREDENTIALS_PATH = path.join(ZHIHAND_DIR, "credentials.json");
const STATE_PATH = path.join(ZHIHAND_DIR, "state.json");

export function resolveZhiHandDir(): string {
  return ZHIHAND_DIR;
}

export function ensureZhiHandDir(): void {
  fs.mkdirSync(ZHIHAND_DIR, { recursive: true });
}

export function loadCredentialStore(): CredentialStore | null {
  if (!fs.existsSync(CREDENTIALS_PATH)) return null;
  try {
    return JSON.parse(fs.readFileSync(CREDENTIALS_PATH, "utf8")) as CredentialStore;
  } catch {
    return null;
  }
}

export function loadDefaultCredential(): DeviceCredential | null {
  const store = loadCredentialStore();
  if (!store) return null;
  return store.devices[store.default] ?? null;
}

export function saveCredential(name: string, cred: DeviceCredential, setDefault: boolean = true): void {
  ensureZhiHandDir();
  let store = loadCredentialStore() ?? { default: name, devices: {} };
  store.devices[name] = cred;
  if (setDefault) store.default = name;
  fs.writeFileSync(CREDENTIALS_PATH, JSON.stringify(store, null, 2));
}

export function resolveConfig(deviceName?: string): ZhiHandConfig {
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

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
export declare const DEFAULT_MODELS: Record<Exclude<BackendName, "openclaw">, string>;
export declare function resolveZhiHandDir(): string;
export declare function ensureZhiHandDir(): void;
export declare function loadConfig(): ZhihandConfig;
export declare function saveConfig(cfg: ZhihandConfig): void;
export declare function addDevice(record: DeviceRecord, makeDefault?: boolean): void;
export declare function removeDevice(credentialId: string): void;
export declare function renameDevice(credentialId: string, label: string): void;
export declare function setDefaultDevice(credentialId: string): void;
export declare function updateLastSeen(credentialId: string, iso: string): void;
export declare function getDeviceRecord(credentialId: string): DeviceRecord | null;
export declare function listDeviceRecords(): DeviceRecord[];
export declare function recordToRuntimeConfig(r: DeviceRecord): ZhiHandRuntimeConfig;
/**
 * Resolve a runtime config for HTTP calls. If credentialId provided, look it up;
 * else use default_credential_id; else throw.
 */
export declare function resolveConfig(credentialId?: string): ZhiHandRuntimeConfig;
export declare function loadState<T = unknown>(): T | null;
export declare function saveState(state: unknown): void;
export declare function loadBackendConfig(): BackendConfig;
export declare function saveBackendConfig(config: BackendConfig): void;

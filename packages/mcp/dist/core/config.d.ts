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
export declare const DEFAULT_MODELS: Record<Exclude<BackendName, "openclaw">, string>;
export interface PluginIdentity {
    stable_identity: string;
    edge_id: string;
    plugin_secret: string;
}
export declare function resolveZhiHandDir(): string;
export declare function ensureZhiHandDir(): void;
export declare function getConfigPath(): string;
/** Read persisted Plugin identity. Returns null if missing or malformed. */
export declare function loadPluginIdentity(): PluginIdentity | null;
/** Atomically persist Plugin identity (write-to-tmp + rename, mode 0o600). */
export declare function savePluginIdentity(identity: PluginIdentity): void;
/** Delete identity.json (used by `zhihand identity reset`). */
export declare function clearPluginIdentity(): void;
export declare function loadConfig(): ZhihandConfigV3;
/**
 * Atomically write config: write to .tmp, then rename. Prevents corruption
 * when the daemon and CLI write concurrently (Gemini code review v0.31).
 */
export declare function saveConfig(cfg: ZhihandConfigV3): void;
/**
 * Clean up legacy config files (v2 schema, credentials.json) before re-pairing.
 * Replaces old config with empty v3 so loadConfig() won't warn.
 */
export declare function cleanupLegacyConfig(): void;
export declare function addUser(user: UserRecord): void;
export declare function removeUser(userId: string): void;
export declare function addDeviceToUser(userId: string, device: DeviceRecord): void;
export declare function removeDeviceFromUser(userId: string, credentialId: string): void;
export declare function updateDeviceLabel(userId: string, credentialId: string, label: string): void;
export declare function updateControllerToken(userId: string, newToken: string): void;
export declare function updateDeviceLastSeen(userId: string, credentialId: string, iso: string): void;
export declare function getUserRecord(userId: string): UserRecord | null;
export declare function findDeviceOwner(credentialId: string): {
    user: UserRecord;
    device: DeviceRecord;
} | null;
export declare function listUsers(): UserRecord[];
export declare function resolveDefaultEndpoint(): string;
/**
 * Resolve a runtime config for HTTP calls. Find which user owns the
 * credential and use the user's controller_token.
 */
export declare function resolveConfig(credentialId?: string): ZhiHandRuntimeConfig;
export declare function loadState<T = unknown>(): T | null;
export declare function saveState(state: unknown): void;
export declare function loadBackendConfig(): BackendConfig;
export declare function saveBackendConfig(config: BackendConfig): void;

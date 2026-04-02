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
export type BackendName = "claudecode" | "codex" | "gemini" | "openclaw";
export interface BackendConfig {
    activeBackend: BackendName | null;
    model?: string | null;
}
/**
 * Default model aliases per backend.
 * These are generic aliases that the respective CLIs resolve to the latest version:
 *   - Gemini CLI: "flash" → latest flash model (e.g. gemini-2.5-flash)
 *   - Claude Code: "sonnet" → latest sonnet (e.g. claude-sonnet-4-20250514)
 *   - Codex CLI: requires full model name, no alias support
 */
export declare const DEFAULT_MODELS: Record<Exclude<BackendName, "openclaw">, string>;
export declare function resolveZhiHandDir(): string;
export declare function ensureZhiHandDir(): void;
export declare function loadCredentialStore(): CredentialStore | null;
export declare function loadDefaultCredential(): DeviceCredential | null;
export declare function saveCredential(name: string, cred: DeviceCredential, setDefault?: boolean): void;
export declare function resolveConfig(deviceName?: string): ZhiHandConfig;
export declare function loadState<T = unknown>(): T | null;
export declare function saveState(state: unknown): void;
export declare function loadBackendConfig(): BackendConfig;
export declare function saveBackendConfig(config: BackendConfig): void;

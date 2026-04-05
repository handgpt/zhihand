import type { ZhiHandRuntimeConfig, BackendName } from "../core/config.ts";
type ZhiHandConfig = ZhiHandRuntimeConfig;
export interface DispatchResult {
    text: string;
    success: boolean;
    durationMs: number;
}
/**
 * Kill the active session. Called by daemon on shutdown or backend switch.
 */
export declare function killActiveChild(): Promise<void>;
export declare function dispatchToCLI(backend: Exclude<BackendName, "openclaw">, prompt: string, log: (msg: string) => void, model?: string): Promise<DispatchResult>;
export declare function postReply(config: ZhiHandConfig, promptId: string, text: string): Promise<boolean>;
export {};

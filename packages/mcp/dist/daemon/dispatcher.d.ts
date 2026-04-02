import type { ZhiHandConfig, BackendName } from "../core/config.ts";
export interface DispatchResult {
    text: string;
    success: boolean;
    durationMs: number;
}
/**
 * Kill the active child process. Returns a promise that resolves
 * when the child has exited (or immediately if no child).
 */
export declare function killActiveChild(): Promise<void>;
export declare function dispatchToCLI(backend: Exclude<BackendName, "openclaw">, prompt: string, log: (msg: string) => void, model?: string): Promise<DispatchResult>;
export declare function postReply(config: ZhiHandConfig, promptId: string, text: string): Promise<boolean>;

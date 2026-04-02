import type { ZhiHandConfig, BackendName } from "../core/config.ts";
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
export interface ReplyMeta {
    /** Backend name: "gemini", "claudecode", "codex" */
    backend?: string;
    /** Model alias or full name as passed to the CLI (e.g. "flash", "sonnet", "gpt-5.4-mini") */
    model?: string;
}
export declare function postReply(config: ZhiHandConfig, promptId: string, text: string, meta?: ReplyMeta): Promise<boolean>;

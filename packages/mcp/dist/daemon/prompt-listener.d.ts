import type { ZhiHandConfig } from "../core/config.ts";
export interface MobilePrompt {
    id: string;
    credential_id: string;
    edge_id: string;
    text: string;
    status: string;
    client_message_id?: string;
    created_at: string;
    attachments?: unknown[];
}
export type PromptHandler = (prompt: MobilePrompt) => void;
export declare class PromptListener {
    private config;
    private handler;
    private log;
    private processedIds;
    private sseAbort;
    private pollTimer;
    private sseConnected;
    private stopped;
    constructor(config: ZhiHandConfig, handler: PromptHandler, log: (msg: string) => void);
    start(): void;
    stop(): void;
    private dispatchPrompt;
    private connectSSE;
    private resetWatchdog;
    private handleSSEEvent;
    private startPolling;
    private stopPolling;
    private poll;
}

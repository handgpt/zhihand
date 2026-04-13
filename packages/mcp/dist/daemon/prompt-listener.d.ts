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
/** Edge-level prompt listener config. Uses pluginSecret instead of per-user controllerToken. */
export interface PromptListenerConfig {
    controlPlaneEndpoint: string;
    edgeId: string;
    pluginSecret: string;
}
export declare class PromptListener {
    private config;
    private handler;
    private log;
    private onFatalError?;
    private processedIds;
    private rws;
    private stopped;
    constructor(config: PromptListenerConfig, handler: PromptHandler, log: (msg: string) => void, onFatalError?: (reason: string) => void);
    start(): void;
    stop(): void;
    private dispatchPrompt;
    private connectWS;
    private handleWSMessage;
    private handleEvent;
}

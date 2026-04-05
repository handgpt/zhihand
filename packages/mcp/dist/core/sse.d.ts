import type { ZhiHandRuntimeConfig } from "./config.ts";
import type { QueuedCommandRecord, WaitForCommandAckResult } from "./command.ts";
export interface SSEEvent {
    id: string;
    topic: string;
    kind: string;
    credential_id: string;
    command?: QueuedCommandRecord;
    device_profile?: Record<string, unknown>;
    sequence: number;
}
export declare function handleSSEEvent(event: SSEEvent): void;
export declare function subscribeToCommandAck(commandId: string, callback: (cmd: QueuedCommandRecord) => void): () => void;
export interface SSEHandlers {
    onEvent: (e: SSEEvent) => void;
    onConnected: () => void;
    onDisconnected: () => void;
}
/**
 * Open a per-credential SSE connection. Caller owns the returned AbortController.
 * The loop auto-reconnects with exponential backoff until aborted.
 */
export declare function connectSSEForCredential(config: ZhiHandRuntimeConfig, handlers: SSEHandlers): AbortController;
/**
 * Wait for command ACK via SSE push (which should already be connected by the
 * registry). Falls back to polling.
 */
export declare function waitForCommandAck(config: ZhiHandRuntimeConfig, options: {
    commandId: string;
    timeoutMs?: number;
    signal?: AbortSignal;
}): Promise<WaitForCommandAckResult>;

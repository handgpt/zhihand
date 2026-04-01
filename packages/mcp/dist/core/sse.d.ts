import type { ZhiHandConfig } from "./config.ts";
import type { QueuedCommandRecord, WaitForCommandAckResult } from "./command.ts";
export interface SSEEvent {
    id: string;
    topic: string;
    kind: string;
    credential_id: string;
    command?: QueuedCommandRecord;
    sequence: number;
}
export declare function handleSSEEvent(event: SSEEvent): void;
export declare function subscribeToCommandAck(commandId: string, callback: (cmd: QueuedCommandRecord) => void): () => void;
/**
 * Connect to the SSE event stream for command ACKs.
 * Maintains a persistent connection that dispatches events to registered callbacks.
 * Reconnects automatically on connection loss.
 */
export declare function connectSSE(config: ZhiHandConfig): void;
/**
 * Disconnect the SSE event stream.
 */
export declare function disconnectSSE(): void;
/**
 * Whether the SSE stream is currently connected.
 */
export declare function isSSEConnected(): boolean;
/**
 * Wait for command ACK via SSE push.
 * Falls back to polling if SSE is not active.
 */
export declare function waitForCommandAck(config: ZhiHandConfig, options: {
    commandId: string;
    timeoutMs?: number;
    signal?: AbortSignal;
}): Promise<WaitForCommandAckResult>;

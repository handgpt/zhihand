/**
 * WebSocket transport — replaces SSE for all real-time event streams.
 *
 * Provides:
 *   - ReconnectingWebSocket: shared base with exponential backoff + jitter,
 *     protocol-level ping/pong watchdog, and Bearer auth via HTTP upgrade header.
 *   - UserEventWebSocket: per-user stream for device registry events.
 *   - Command ACK infrastructure (handleWSEvent, subscribeToCommandAck, waitForCommandAck).
 *   - fetchUserCredentials: HTTP REST helper (unchanged from sse.ts).
 */
import type { ZhiHandRuntimeConfig } from "./config.ts";
import type { QueuedCommandRecord, WaitForCommandAckResult } from "./command.ts";
export interface ReconnectingWSOptions {
    url: string;
    headers?: Record<string, string>;
    onOpen?: () => void;
    onClose?: (code: number, reason: string) => void;
    onMessage?: (data: unknown) => void;
    onError?: (err: Error) => void;
}
export declare class ReconnectingWebSocket {
    private opts;
    private ws;
    private backoffMs;
    private aborted;
    private watchdogTimer;
    private reconnectTimer;
    private hadOpen;
    private consecutiveFailures;
    private static readonly MAX_CONSECUTIVE_FAILURES;
    constructor(opts: ReconnectingWSOptions);
    start(): void;
    stop(): void;
    send(data: string): void;
    get connected(): boolean;
    private connect;
    private scheduleReconnect;
    private resetWatchdog;
    private clearWatchdog;
}
export interface WSEvent {
    id: string;
    topic: string;
    kind: string;
    credential_id: string;
    command?: QueuedCommandRecord;
    device_profile?: Record<string, unknown>;
    credential?: Record<string, unknown>;
    payload?: Record<string, unknown>;
    sequence: number;
}
export declare function handleWSEvent(event: WSEvent): void;
export declare function subscribeToCommandAck(commandId: string, callback: (cmd: QueuedCommandRecord) => void): () => void;
export interface UserEventStreamHandlers {
    onDeviceOnline: (credentialId: string) => void;
    onDeviceOffline: (credentialId: string) => void;
    onDeviceProfileUpdated: (credentialId: string, profile: Record<string, unknown>) => void;
    onCommandAcked: (event: WSEvent) => void;
    onCredentialAdded: (credential: Record<string, unknown>) => void;
    onCredentialRemoved: (credentialId: string) => void;
    onConnected: () => void;
    onDisconnected: () => void;
}
export declare class UserEventWebSocket {
    private controllerToken;
    private handlers;
    private rws;
    private lastProcessedSeq;
    constructor(userId: string, controllerToken: string, endpoint: string, handlers: UserEventStreamHandlers);
    get connected(): boolean;
    start(): void;
    stop(): void;
    private handleMessage;
    private dispatchEvent;
}
export interface CredentialResponse {
    credential_id: string;
    label?: string;
    platform?: string;
    online?: boolean;
    paired_at?: string;
    last_seen_at?: string;
    device_profile?: Record<string, unknown>;
}
export declare function fetchUserCredentials(endpoint: string, userId: string, controllerToken: string, onlineFilter?: boolean): Promise<CredentialResponse[]>;
/**
 * Wait for command ACK via WS push (which should already be connected by the
 * registry). WS-only — no polling fallback.
 */
export declare function waitForCommandAck(_config: ZhiHandRuntimeConfig, options: {
    commandId: string;
    timeoutMs?: number;
    signal?: AbortSignal;
}): Promise<WaitForCommandAckResult>;

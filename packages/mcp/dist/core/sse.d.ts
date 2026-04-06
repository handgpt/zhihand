import type { ZhiHandRuntimeConfig } from "./config.ts";
import type { QueuedCommandRecord, WaitForCommandAckResult } from "./command.ts";
export interface SSEEvent {
    id: string;
    topic: string;
    kind: string;
    credential_id: string;
    command?: QueuedCommandRecord;
    device_profile?: Record<string, unknown>;
    credential?: Record<string, unknown>;
    sequence: number;
}
export declare function handleSSEEvent(event: SSEEvent): void;
export declare function subscribeToCommandAck(commandId: string, callback: (cmd: QueuedCommandRecord) => void): () => void;
export interface UserEventStreamHandlers {
    onDeviceOnline: (credentialId: string) => void;
    onDeviceOffline: (credentialId: string) => void;
    onDeviceProfileUpdated: (credentialId: string, profile: Record<string, unknown>) => void;
    onCommandAcked: (event: SSEEvent) => void;
    onCredentialAdded: (credential: Record<string, unknown>) => void;
    onCredentialRemoved: (credentialId: string) => void;
    onConnected: () => void;
    onDisconnected: () => void;
}
export declare class UserEventStream {
    private userId;
    private controllerToken;
    private endpoint;
    private handlers;
    private abortController;
    private _connected;
    constructor(userId: string, controllerToken: string, endpoint: string, handlers: UserEventStreamHandlers);
    get connected(): boolean;
    start(): void;
    stop(): void;
    private runLoop;
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
 * Wait for command ACK via SSE push (which should already be connected by the
 * registry). Falls back to polling.
 */
export declare function waitForCommandAck(config: ZhiHandRuntimeConfig, options: {
    commandId: string;
    timeoutMs?: number;
    signal?: AbortSignal;
}): Promise<WaitForCommandAckResult>;

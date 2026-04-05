/**
 * Device registry — the single source of truth for all paired devices,
 * their live state (profile, online flag, SSE connection), and multi-
 * device routing.
 *
 * Holds a per-credential AbortController for SSE, a per-device heartbeat
 * timer, and a single debounced notifier for list_changed.
 */
import { type DeviceRecord, type ZhiHandRuntimeConfig } from "./config.ts";
import { type StaticContext, type Capabilities } from "./device.ts";
export interface DeviceState {
    credentialId: string;
    label: string;
    platform: "ios" | "android" | "unknown";
    online: boolean;
    lastSeenAtMs: number;
    profile: StaticContext | null;
    capabilities: Capabilities | null;
    profileReceivedAtMs: number;
    rawAttributes: Record<string, unknown>;
    sseController: AbortController | null;
    sseConnected: boolean;
    heartbeatTimer: ReturnType<typeof setInterval> | null;
    record: DeviceRecord;
}
type ListChangedCb = () => void;
declare class Registry {
    private devices;
    private listChangedSubs;
    private debounceTimer;
    private lastOnlineSet;
    private initialized;
    get(credentialId: string): DeviceState | null;
    list(): DeviceState[];
    listOnline(): DeviceState[];
    /**
     * Priority:
     *   1. If the user has explicitly set a default via `zhihand default <id>`
     *      AND that device is online → return it. Honoring an explicit user
     *      preference is the least-surprising UX.
     *   2. Otherwise → most-recently-active online device (online[0] is sorted
     *      desc by lastSeenAtMs).
     *   3. No online devices → null.
     */
    resolveDefault(): DeviceState | null;
    toRuntimeConfig(state: DeviceState): ZhiHandRuntimeConfig;
    subscribe(cb: ListChangedCb): () => void;
    private computeOnlineSet;
    private setsEqual;
    private scheduleListChanged;
    private updateOnlineFlag;
    private touchLastSeen;
    private refreshProfile;
    private startHeartbeat;
    private stopHeartbeat;
    private startSSE;
    private stopSSE;
    private makeState;
    init(): Promise<void>;
    addDevice(record: DeviceRecord): Promise<void>;
    removeDevice(credentialId: string): void;
    renameDevice(credentialId: string, label: string): void;
    setDefault(credentialId: string): void;
    shutdown(): void;
}
export declare const registry: Registry;
export {};

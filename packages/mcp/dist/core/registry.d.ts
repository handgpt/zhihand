/**
 * Device registry — the single source of truth for all paired devices,
 * their live state, and multi-user WebSocket streams.
 *
 * Groups devices under users. Each user has one UserEventWebSocket.
 * Online detection is server-authoritative (no local heartbeat polling).
 * Config hot-reload via fs.watchFile.
 */
import { type DeviceRecord, type DevicePlatform, type ZhiHandRuntimeConfig } from "./config.ts";
import { type StaticContext, type Capabilities } from "./device.ts";
export interface DeviceState {
    credentialId: string;
    userId: string;
    userLabel: string;
    label: string;
    platform: DevicePlatform;
    online: boolean;
    lastSeenAtMs: number;
    profile: StaticContext | null;
    capabilities: Capabilities | null;
    profileReceivedAtMs: number;
    rawAttributes: Record<string, unknown>;
    record: DeviceRecord;
}
type ListChangedCb = () => void;
declare class Registry {
    private userStates;
    private listChangedSubs;
    private debounceTimer;
    private lastOnlineSet;
    private initialized;
    private configWatchActive;
    private reconcileTimer;
    get(credentialId: string): DeviceState | null;
    list(): DeviceState[];
    listOnline(): DeviceState[];
    /**
     * Most-recently-active online device across all users.
     */
    resolveDefault(): DeviceState | null;
    isMultiUser(): boolean;
    toRuntimeConfig(state: DeviceState): ZhiHandRuntimeConfig;
    subscribe(cb: ListChangedCb): () => void;
    init(): Promise<void>;
    shutdown(): void;
    private computeOnlineSet;
    private setsEqual;
    private scheduleListChanged;
    private createUserState;
    private makeDeviceState;
    private populateDevicesFromConfig;
    private fetchAndPopulateDevices;
    private startUserStream;
    private touchLastSeen;
    private startConfigWatch;
    private stopConfigWatch;
    private reconcileConfig;
}
export declare const registry: Registry;
export {};

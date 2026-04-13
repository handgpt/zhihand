/** Brain metadata included in every heartbeat, so the app always knows the current backend/model. */
export interface BrainMeta {
    backend?: string | null;
    model?: string | null;
}
/** Plugin-level heartbeat target. Uses edgeId + pluginSecret instead of per-credential auth. */
export interface HeartbeatTarget {
    controlPlaneEndpoint: string;
    edgeId: string;
    pluginSecret: string;
}
/** Update the backend/model metadata that will be sent with the next heartbeat. */
export declare function setBrainMeta(meta: BrainMeta): void;
export declare function sendBrainOnline(target: HeartbeatTarget): Promise<boolean>;
export declare function sendBrainOffline(target: HeartbeatTarget): Promise<boolean>;
export declare function startHeartbeatLoop(target: HeartbeatTarget, log: (msg: string) => void): void;
export declare function stopHeartbeatLoop(): void;

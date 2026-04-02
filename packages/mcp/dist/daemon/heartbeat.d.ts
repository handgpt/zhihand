import type { ZhiHandConfig } from "../core/config.ts";
/** Brain metadata included in every heartbeat, so the app always knows the current backend/model. */
export interface BrainMeta {
    backend?: string | null;
    model?: string | null;
}
/** Update the backend/model metadata that will be sent with the next heartbeat. */
export declare function setBrainMeta(meta: BrainMeta): void;
export declare function sendBrainOnline(config: ZhiHandConfig): Promise<boolean>;
export declare function sendBrainOffline(config: ZhiHandConfig): Promise<boolean>;
export declare function startHeartbeatLoop(config: ZhiHandConfig, log: (msg: string) => void): void;
export declare function stopHeartbeatLoop(): void;

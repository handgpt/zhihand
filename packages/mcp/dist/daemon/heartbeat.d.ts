import type { ZhiHandRuntimeConfig } from "../core/config.ts";
/** Brain metadata included in every heartbeat, so the app always knows the current backend/model. */
export interface BrainMeta {
    backend?: string | null;
    model?: string | null;
}
/** Update the backend/model metadata that will be sent with the next heartbeat. */
export declare function setBrainMeta(meta: BrainMeta): void;
export declare function sendBrainOnline(config: ZhiHandRuntimeConfig): Promise<boolean>;
export declare function sendBrainOffline(config: ZhiHandRuntimeConfig): Promise<boolean>;
export declare function startHeartbeatLoop(config: ZhiHandRuntimeConfig, log: (msg: string) => void): void;
export declare function stopHeartbeatLoop(): void;

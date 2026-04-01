import type { ZhiHandConfig } from "../core/config.ts";
export declare function sendBrainOnline(config: ZhiHandConfig): Promise<boolean>;
export declare function sendBrainOffline(config: ZhiHandConfig): Promise<boolean>;
export declare function startHeartbeatLoop(config: ZhiHandConfig, log: (msg: string) => void): void;
export declare function stopHeartbeatLoop(): void;

import type { ZhiHandRuntimeConfig } from "./config.ts";
export declare function getSnapshotStaleThresholdMs(): number;
export interface ScreenshotResult {
    buffer: Buffer;
    ageMs: number;
    width: number;
    height: number;
    capturedAt: string | null;
    sequence: number;
    stale: boolean;
}
export declare function fetchScreenshot(config: ZhiHandRuntimeConfig): Promise<ScreenshotResult>;
export declare function fetchScreenshotBinary(config: ZhiHandRuntimeConfig): Promise<Buffer>;

/**
 * Device Context — static + dynamic device info fetched from control plane.
 *
 * Static info (platform, model, screen size) is set once after pairing and
 * injected into MCP tool descriptions so the LLM always knows the device.
 *
 * Dynamic info (battery, network, BLE) is updated via SSE push and exposed
 * through the zhihand_status tool and device://profile resource.
 */
import type { ZhiHandConfig } from "./config.ts";
export interface StaticContext {
    platform: string;
    model: string;
    osVersion: string;
    screenWidthPx: number;
    screenHeightPx: number;
    density: number;
    formFactor: string;
    locale: string;
    textDirection: string;
    timezone: string;
    navigationMode?: string;
    romFamily?: string;
}
export interface DynamicContext {
    batteryLevel: number;
    batteryState: string;
    networkType: string;
    bleRssi: number | null;
    darkMode: boolean;
    hidConnected: boolean;
    recordingActive: boolean;
    appInForeground: boolean;
    availableStorageMb: number;
    thermalState?: string;
    fontScale: number;
}
export declare function getStaticContext(): StaticContext;
export declare function getDynamicContext(): DynamicContext;
export declare function isDeviceProfileLoaded(): boolean;
export declare function extractStatic(profile: Record<string, unknown>): StaticContext;
export declare function extractDynamic(profile: Record<string, unknown>): DynamicContext;
export declare function updateDeviceProfile(profile: Record<string, unknown>): void;
export declare function fetchDeviceProfile(config: ZhiHandConfig): Promise<void>;
export declare function buildControlToolDescription(): string;
export declare function buildScreenshotToolDescription(): string;
export declare function formatDeviceStatus(): Record<string, unknown>;

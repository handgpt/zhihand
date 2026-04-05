/**
 * Device profile extraction & formatting — stateless.
 *
 * Per-device state (profile, raw attributes, timestamps) lives in the
 * device registry (see ./registry.ts). This module exposes pure helpers
 * to extract, classify, and format device data so the same logic can be
 * applied to any number of devices.
 */
import type { ZhiHandRuntimeConfig } from "./config.ts";
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
declare const DEFAULT_STATIC: StaticContext;
declare const DEFAULT_DYNAMIC: DynamicContext;
export interface Capability {
    ready: boolean;
    reason: string;
}
export interface Capabilities {
    screen_sharing: Capability;
    hid: Capability;
    live_session: Capability;
    profile: {
        age_ms: number;
        stale: boolean;
    };
}
export declare function computeCapabilities(rawAttributes: Record<string, unknown>, profileReceivedAtMs: number): Capabilities;
export declare function extractStatic(profile: Record<string, unknown>): StaticContext;
export declare function extractDynamic(profile: Record<string, unknown>): DynamicContext;
/**
 * Fetch and normalize the device profile from the control plane once.
 * Returns null on failure (HTTP or network).
 */
export declare function fetchDeviceProfileOnce(config: ZhiHandRuntimeConfig): Promise<{
    rawAttrs: Record<string, unknown>;
    receivedAtMs: number;
} | null>;
/**
 * Normalize an SSE device_profile.updated payload into rawAttrs shape.
 */
export declare function normalizeProfilePayload(raw: Record<string, unknown>): Record<string, unknown>;
export declare function pickAllowlistedRawAttributes(rawAttributes: Record<string, unknown>): Record<string, unknown>;
export { DEFAULT_STATIC, DEFAULT_DYNAMIC };
import type { DeviceState } from "./registry.ts";
export declare function buildControlToolDescription(state: DeviceState | null, onlineStates?: DeviceState[]): string;
export declare function buildSystemToolDescription(state: DeviceState | null, onlineStates?: DeviceState[]): string;
export declare function buildScreenshotToolDescription(state: DeviceState | null, onlineStates?: DeviceState[]): string;
export declare function formatDeviceStatus(state: DeviceState): Record<string, unknown>;

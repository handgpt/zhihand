/**
 * Device Context — static + dynamic device info fetched from control plane.
 *
 * Static info (platform, model, screen size) is set once after pairing and
 * injected into MCP tool descriptions so the LLM always knows the device.
 *
 * Dynamic info (battery, network, BLE) is updated via SSE push and exposed
 * through the zhihand_status tool and device://profile resource.
 */
import { dbg } from "../daemon/logger.js";
// ── Default values ────────────────────────────────────────
const DEFAULT_STATIC = {
    platform: "unknown",
    model: "unknown",
    osVersion: "unknown",
    screenWidthPx: 0,
    screenHeightPx: 0,
    density: 1,
    formFactor: "phone",
    locale: "en-US",
    textDirection: "ltr",
    timezone: "UTC",
};
const DEFAULT_DYNAMIC = {
    batteryLevel: -1,
    batteryState: "unknown",
    networkType: "unknown",
    bleRssi: null,
    darkMode: false,
    hidConnected: false,
    recordingActive: false,
    appInForeground: false,
    availableStorageMb: -1,
    fontScale: 1,
};
// ── Module state ──────────────────────────────────────────
let staticCtx = { ...DEFAULT_STATIC };
let dynamicCtx = { ...DEFAULT_DYNAMIC };
let loaded = false;
export function getStaticContext() {
    return staticCtx;
}
export function getDynamicContext() {
    return dynamicCtx;
}
export function isDeviceProfileLoaded() {
    return loaded;
}
// ── Extract helpers ───────────────────────────────────────
function str(v, fallback) {
    return typeof v === "string" && v ? v : fallback;
}
function num(v, fallback) {
    return typeof v === "number" && !isNaN(v) ? v : fallback;
}
function bool(v, fallback) {
    return typeof v === "boolean" ? v : fallback;
}
export function extractStatic(profile) {
    return {
        platform: str(profile.platform, DEFAULT_STATIC.platform),
        model: str(profile.model, DEFAULT_STATIC.model),
        osVersion: str(profile.os_version, DEFAULT_STATIC.osVersion),
        screenWidthPx: num(profile.screen_width_px, DEFAULT_STATIC.screenWidthPx),
        screenHeightPx: num(profile.screen_height_px, DEFAULT_STATIC.screenHeightPx),
        density: num(profile.density, DEFAULT_STATIC.density),
        formFactor: str(profile.form_factor, DEFAULT_STATIC.formFactor),
        locale: str(profile.locale, DEFAULT_STATIC.locale),
        textDirection: str(profile.text_direction, DEFAULT_STATIC.textDirection),
        timezone: str(profile.timezone, DEFAULT_STATIC.timezone),
        navigationMode: typeof profile.navigation_mode === "string" ? profile.navigation_mode : undefined,
        romFamily: typeof profile.rom_family === "string" ? profile.rom_family : undefined,
    };
}
export function extractDynamic(profile) {
    return {
        batteryLevel: num(profile.battery_level, DEFAULT_DYNAMIC.batteryLevel),
        batteryState: str(profile.battery_state, DEFAULT_DYNAMIC.batteryState),
        networkType: str(profile.network_type, DEFAULT_DYNAMIC.networkType),
        bleRssi: typeof profile.ble_rssi === "number" ? profile.ble_rssi : null,
        darkMode: bool(profile.dark_mode, DEFAULT_DYNAMIC.darkMode),
        hidConnected: bool(profile.hid_connected, DEFAULT_DYNAMIC.hidConnected),
        recordingActive: bool(profile.recording_active, DEFAULT_DYNAMIC.recordingActive),
        appInForeground: bool(profile.app_in_foreground, DEFAULT_DYNAMIC.appInForeground),
        availableStorageMb: num(profile.available_storage_mb, DEFAULT_DYNAMIC.availableStorageMb),
        thermalState: typeof profile.thermal_state === "string" ? profile.thermal_state : undefined,
        fontScale: num(profile.font_scale, DEFAULT_DYNAMIC.fontScale),
    };
}
// ── Update from SSE event ─────────────────────────────────
export function updateDeviceProfile(profile) {
    staticCtx = extractStatic(profile);
    dynamicCtx = extractDynamic(profile);
    loaded = true;
    dbg(`[device] Profile updated: platform=${staticCtx.platform}, model=${staticCtx.model}, screen=${staticCtx.screenWidthPx}x${staticCtx.screenHeightPx}`);
}
// ── Fetch initial profile from API ────────────────────────
export async function fetchDeviceProfile(config) {
    const url = `${config.controlPlaneEndpoint}/v1/credentials/${encodeURIComponent(config.credentialId)}/device-profile`;
    dbg(`[device] Fetching profile: GET ${url}`);
    try {
        const response = await fetch(url, {
            headers: { "x-zhihand-controller-token": config.controllerToken },
            signal: AbortSignal.timeout(10_000),
        });
        if (!response.ok) {
            dbg(`[device] Profile fetch failed: ${response.status} ${response.statusText}`);
            return;
        }
        const data = await response.json();
        // API may wrap in { device_profile: {...} } or return flat
        const profile = (typeof data.device_profile === "object" && data.device_profile !== null)
            ? data.device_profile
            : data;
        updateDeviceProfile(profile);
    }
    catch (err) {
        dbg(`[device] Profile fetch error: ${err.message}`);
    }
}
// ── Build tool description with device info ───────────────
export function buildControlToolDescription() {
    if (!loaded || staticCtx.platform === "unknown") {
        return "Control the connected mobile device. Supports click, swipe, type, scroll, open_app, back, home, and more. All coordinates use normalized ratios [0,1].";
    }
    const parts = [
        `Control a ${staticCtx.platform} device`,
        `(${staticCtx.model}, ${staticCtx.osVersion}`,
        `${staticCtx.screenWidthPx}x${staticCtx.screenHeightPx}`,
        `${staticCtx.formFactor}, ${staticCtx.locale})`,
    ];
    let desc = parts.join(", ") + ".";
    desc += " All coordinates use normalized ratios [0,1].";
    // Platform-specific open_app guidance
    if (staticCtx.platform === "android") {
        desc += " For open_app, use appPackage (e.g. 'com.tencent.mm'). Do NOT send bundleId or urlScheme.";
    }
    else if (staticCtx.platform === "ios") {
        desc += " For open_app, use bundleId (e.g. 'com.tencent.xin') or urlScheme (e.g. 'weixin://'). Do NOT send appPackage.";
    }
    return desc;
}
export function buildScreenshotToolDescription() {
    if (!loaded || staticCtx.platform === "unknown") {
        return "Take a screenshot of the phone screen.";
    }
    return `Take a screenshot of the ${staticCtx.platform} device (${staticCtx.model}, ${staticCtx.screenWidthPx}x${staticCtx.screenHeightPx}).`;
}
// ── Format status for zhihand_status tool ─────────────────
export function formatDeviceStatus() {
    return {
        platform: staticCtx.platform,
        model: staticCtx.model,
        os_version: staticCtx.osVersion,
        screen: `${staticCtx.screenWidthPx}x${staticCtx.screenHeightPx}`,
        density: staticCtx.density,
        form_factor: staticCtx.formFactor,
        locale: staticCtx.locale,
        timezone: staticCtx.timezone,
        navigation_mode: staticCtx.navigationMode ?? null,
        battery: `${dynamicCtx.batteryLevel}% (${dynamicCtx.batteryState})`,
        network: dynamicCtx.networkType,
        ble: dynamicCtx.hidConnected
            ? `connected${dynamicCtx.bleRssi !== null ? ` (RSSI: ${dynamicCtx.bleRssi})` : ""}`
            : "disconnected",
        dark_mode: dynamicCtx.darkMode,
        storage_available_mb: dynamicCtx.availableStorageMb,
        thermal: dynamicCtx.thermalState ?? "normal",
        font_scale: dynamicCtx.fontScale,
    };
}

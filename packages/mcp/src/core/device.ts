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
import { dbg } from "../daemon/logger.ts";

// ── Interfaces ────────────────────────────────────────────

export interface StaticContext {
  platform: string;          // "android" | "ios"
  model: string;             // "Pixel 9 Pro" | "iPhone 15 Pro"
  osVersion: string;         // "Android 15 (API 35)" | "iOS 18.3"
  screenWidthPx: number;     // 1080
  screenHeightPx: number;    // 2400
  density: number;           // 2.75
  formFactor: string;        // "phone" | "tablet"
  locale: string;            // "zh-CN"
  textDirection: string;     // "ltr" | "rtl"
  timezone: string;          // "Asia/Shanghai"
  navigationMode?: string;   // Android: "gesture" | "three_button"
  romFamily?: string;        // Android: "HyperOS" | "OneUI" | "stock"
}

export interface DynamicContext {
  batteryLevel: number;          // 0-100
  batteryState: string;          // "charging" | "unplugged" | "full"
  networkType: string;           // "wifi" | "cellular" | "ethernet" | "none" | "other"
  bleRssi: number | null;       // HID signal strength (dBm)
  darkMode: boolean;
  hidConnected: boolean;
  recordingActive: boolean;
  appInForeground: boolean;
  availableStorageMb: number;
  thermalState?: string;         // "nominal" | "fair" | "serious" | "critical"
  fontScale: number;
}

// ── Default values ────────────────────────────────────────

const DEFAULT_STATIC: StaticContext = {
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

const DEFAULT_DYNAMIC: DynamicContext = {
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

let staticCtx: StaticContext = { ...DEFAULT_STATIC };
let dynamicCtx: DynamicContext = { ...DEFAULT_DYNAMIC };
let rawAttributes: Record<string, unknown> = {};
// Local monotonic timestamp (Date.now()) captured when the profile was last
// updated. Used for age calculations — avoids distributed clock skew vs.
// reading server-side `updated_at`.
let profileReceivedAtMs = 0;
let loaded = false;

export function getStaticContext(): StaticContext {
  return staticCtx;
}

export function getDynamicContext(): DynamicContext {
  return dynamicCtx;
}

export function getRawAttributes(): Record<string, unknown> {
  return rawAttributes;
}

export function getProfileAgeMs(): number {
  if (!loaded || profileReceivedAtMs === 0) return Number.POSITIVE_INFINITY;
  return Date.now() - profileReceivedAtMs;
}

export function isDeviceProfileLoaded(): boolean {
  return loaded;
}

// ── Capability readiness ─────────────────────────────────
// Derived from DeviceProfile.attributes. Each capability is exposed with
// both the boolean `ready` flag and a human-readable `reason` string so
// the LLM can second-guess us if needed.

export interface Capability {
  ready: boolean;
  reason: string;
}

export interface Capabilities {
  screen_sharing: Capability;
  hid: Capability;
  live_session: Capability;
  profile: { age_ms: number; stale: boolean };
}

// Max age (ms) before the device profile is considered stale. Bounds to
// 60s: profile updates are pushed ~every 10–30s by the phone app.
const PROFILE_STALE_THRESHOLD_MS = 60_000;

export function getCapabilities(): Capabilities {
  const a = rawAttributes;
  const b = (k: string): boolean | undefined =>
    typeof a[k] === "boolean" ? (a[k] as boolean) : undefined;

  const recordingActive = b("recording_active");
  const hidConnected = b("hid_connected");
  const hidBonded = b("hid_bonded");
  const hidPairing = b("hid_pairing");
  const hidSessionReady = b("hid_session_ready");
  const liveSessionActive = b("live_session_active");
  const pairedHostReady = b("paired_host_ready");

  const screenSharingReady = recordingActive === true;
  // HID is "ready" when we have a connected bonded peripheral and aren't
  // mid-pairing. `hid_session_ready` is advisory — some devices keep it
  // false while HID still works, so we don't require it.
  const hidReady =
    hidConnected === true && hidBonded === true && hidPairing !== true;
  // Strict AND: a "ready" live session requires both an active socket
  // and a paired host. Using OR here would mask a dead session when a
  // host is still paired from a previous run.
  const liveReady =
    liveSessionActive === true && pairedHostReady === true;

  const ageMs = getProfileAgeMs();
  const stale = ageMs > PROFILE_STALE_THRESHOLD_MS;

  return {
    screen_sharing: {
      ready: screenSharingReady,
      reason: screenSharingReady
        ? "recording_active=true"
        : `recording_active=${recordingActive ?? "unknown"} — phone is not screen-sharing; start sharing in the app to enable screenshots`,
    },
    hid: {
      ready: hidReady,
      reason: hidReady
        ? `connected=true, bonded=true, session_ready=${hidSessionReady ?? "unknown"}`
        : `connected=${hidConnected ?? "unknown"}, bonded=${hidBonded ?? "unknown"}, pairing=${hidPairing ?? "unknown"}, session_ready=${hidSessionReady ?? "unknown"} — connect the ZhiHand (BLE HID) to enable input`,
    },
    live_session: {
      ready: liveReady,
      reason: liveReady
        ? `live_session_active=${liveSessionActive ?? "-"}, paired_host_ready=${pairedHostReady ?? "-"}`
        : `live_session_active=${liveSessionActive ?? "unknown"}, paired_host_ready=${pairedHostReady ?? "unknown"}`,
    },
    profile: {
      age_ms: Number.isFinite(ageMs) ? ageMs : -1,
      stale,
    },
  };
}

// ── Extract helpers ───────────────────────────────────────

function str(v: unknown, fallback: string): string {
  return typeof v === "string" && v ? v : fallback;
}

function num(v: unknown, fallback: number): number {
  return typeof v === "number" && !isNaN(v) ? v : fallback;
}

function bool(v: unknown, fallback: boolean): boolean {
  return typeof v === "boolean" ? v : fallback;
}

export function extractStatic(profile: Record<string, unknown>): StaticContext {
  // Build OS version string from platform + system_release + api_level
  const platform = str(profile.platform, DEFAULT_STATIC.platform);
  const sysRelease = str(profile.system_release, "");
  const apiLevel = typeof profile.api_level === "number" ? profile.api_level : null;
  let osVersion: string;
  if (platform === "android" && sysRelease && apiLevel) {
    osVersion = `Android ${sysRelease} (API ${apiLevel})`;
  } else if (platform === "ios" && sysRelease) {
    osVersion = `iOS ${sysRelease}`;
  } else {
    osVersion = sysRelease || DEFAULT_STATIC.osVersion;
  }

  // Screen size: Android uses display_width_px/display_height_px, iOS uses display_width_pixels/display_height_pixels
  const screenW = num(profile.display_width_px, num(profile.display_width_pixels, DEFAULT_STATIC.screenWidthPx));
  const screenH = num(profile.display_height_px, num(profile.display_height_pixels, DEFAULT_STATIC.screenHeightPx));
  // Density: Android uses density, iOS uses display_scale
  const density = num(profile.density, num(profile.display_scale, DEFAULT_STATIC.density));
  // Text direction: rtl is boolean
  const textDirection = profile.rtl === true ? "rtl" : "ltr";

  return {
    platform,
    model: str(profile.model, DEFAULT_STATIC.model),
    osVersion,
    screenWidthPx: screenW,
    screenHeightPx: screenH,
    density,
    formFactor: str(profile.form_factor, DEFAULT_STATIC.formFactor),
    locale: str(profile.locale, DEFAULT_STATIC.locale),
    textDirection,
    timezone: str(profile.timezone, DEFAULT_STATIC.timezone),
    navigationMode: typeof profile.navigation_mode === "string" ? profile.navigation_mode : undefined,
    romFamily: typeof profile.rom_family === "string" ? profile.rom_family : undefined,
  };
}

export function extractDynamic(profile: Record<string, unknown>): DynamicContext {
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

export function updateDeviceProfile(raw: Record<string, unknown>): void {
  // SSE events may also wrap in { platform, attributes: {...} } — flatten if needed
  let profile: Record<string, unknown>;
  if (typeof raw.attributes === "object" && raw.attributes !== null) {
    const attrs = raw.attributes as Record<string, unknown>;
    profile = { ...attrs, platform: raw.platform ?? attrs.platform };
  } else {
    profile = raw;
  }
  staticCtx = extractStatic(profile);
  dynamicCtx = extractDynamic(profile);
  rawAttributes = profile;
  profileReceivedAtMs = Date.now();
  loaded = true;
  dbg(`[device] Profile updated: platform=${staticCtx.platform}, model=${staticCtx.model}, screen=${staticCtx.screenWidthPx}x${staticCtx.screenHeightPx}`);
}

// ── Fetch initial profile from API ────────────────────────

export async function fetchDeviceProfile(config: ZhiHandConfig): Promise<void> {
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
    const data = await response.json() as Record<string, unknown>;
    // API returns { profile: { credential_id, platform, attributes: {...} } }
    const wrapper = (typeof data.profile === "object" && data.profile !== null)
      ? data.profile as Record<string, unknown>
      : data;
    // Merge top-level fields (platform, edge_id) with attributes for flat extraction
    const attrs = (typeof wrapper.attributes === "object" && wrapper.attributes !== null)
      ? wrapper.attributes as Record<string, unknown>
      : {};
    const profile = { ...attrs, platform: wrapper.platform ?? attrs.platform };
    dbg(`[device] Raw profile keys: ${Object.keys(profile).join(", ")}`);
    updateDeviceProfile(profile);
  } catch (err) {
    dbg(`[device] Profile fetch error: ${(err as Error).message}`);
  }
}

// ── Build tool description with device info ───────────────

export function buildControlToolDescription(): string {
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
  } else if (staticCtx.platform === "ios") {
    desc += " For open_app, use bundleId (e.g. 'com.tencent.xin') or urlScheme (e.g. 'weixin://'). Do NOT send appPackage.";
  }

  return desc;
}

export function buildSystemToolDescription(): string {
  if (!loaded || staticCtx.platform === "unknown") {
    return "System navigation and media controls. Actions: notification, recent, search, switch_input, siri (iOS), control_center (iOS), open_browser (Android), shortcut_help (Android), volume_up/down, mute, play_pause, stop, next/prev_track, fast_forward, rewind, brightness_up/down, power.";
  }
  const platform = staticCtx.platform;
  const parts: string[] = [
    `System navigation and media controls for ${platform} device (${staticCtx.model}).`,
  ];

  // Navigation
  parts.push("Navigation: notification, recent, search (optional text query), switch_input.");
  if (platform === "ios") {
    parts.push("iOS: siri, control_center.");
  } else if (platform === "android") {
    parts.push("Android: open_browser, shortcut_help.");
  }

  // Media
  parts.push("Media: volume_up, volume_down, mute, play_pause, stop, next_track, prev_track, fast_forward, rewind.");

  // Hardware
  parts.push("Hardware: brightness_up, brightness_down, power.");

  return parts.join(" ");
}

export function buildScreenshotToolDescription(): string {
  if (!loaded || staticCtx.platform === "unknown") {
    return "Take a screenshot of the phone screen.";
  }
  return `Take a screenshot of the ${staticCtx.platform} device (${staticCtx.model}, ${staticCtx.screenWidthPx}x${staticCtx.screenHeightPx}).`;
}

// ── Format status for zhihand_status tool ─────────────────

// Allowlist of raw attribute keys exposed via zhihand_status.
// Keeps context window manageable and blocks sensitive/internal fields
// (e.g. credential_status, full_access_*). Wire-format names are kept
// verbatim so the LLM can cite them consistently with the server logs.
const RAW_ATTRIBUTE_ALLOWLIST: readonly string[] = [
  // Device identity
  "brand", "manufacturer", "model", "rom_family", "rom_version",
  "system_release", "api_level", "app_version", "app_build",
  // Display / form factor
  "display_width_px", "display_height_px", "density", "density_dpi",
  "screen_width_dp", "screen_height_dp", "smallest_width_dp",
  "form_factor", "orientation", "touchscreen", "navigation_mode",
  // Locale / UI
  "locale", "language", "timezone", "rtl", "dark_mode", "font_scale",
  // Power / thermal / storage
  "battery_level", "battery_state", "available_storage_mb",
  "thermal_state", "low_ram_device",
  // Network
  "network_type",
  // Capability / readiness signals (most important for LLM diagnosis)
  "hid_connected", "hid_bonded", "hid_pairing", "hid_session_ready",
  "live_session_active", "paired_host_ready", "recording_active",
  "recording_archive_enabled", "app_in_foreground", "task_running",
  "emergency_stop_armed", "firmware_update_in_progress",
  "hardware_keyboard_present", "hard_keyboard_hidden",
  "supports_keyboard_prompt_navigation",
];

function pickAllowlistedRawAttributes(): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of RAW_ATTRIBUTE_ALLOWLIST) {
    if (k in rawAttributes && rawAttributes[k] !== undefined) {
      out[k] = rawAttributes[k];
    }
  }
  return out;
}

export function formatDeviceStatus(): Record<string, unknown> {
  return {
    // Curated summary (human-readable, stable schema)
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
    // Readiness — always present so LLM knows what works right now
    capabilities: getCapabilities(),
    // Full (allowlisted) attributes from the device — wire-format names
    raw: pickAllowlistedRawAttributes(),
  };
}

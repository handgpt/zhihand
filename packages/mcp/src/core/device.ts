/**
 * Device profile extraction & formatting — stateless.
 *
 * Per-device state (profile, raw attributes, timestamps) lives in the
 * device registry (see ./registry.ts). This module exposes pure helpers
 * to extract, classify, and format device data so the same logic can be
 * applied to any number of devices.
 */

import type { ZhiHandRuntimeConfig } from "./config.ts";
import { log } from "./logger.ts";

// ── Interfaces ────────────────────────────────────────────

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

// ── Capability readiness ─────────────────────────────────

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

const PROFILE_STALE_THRESHOLD_MS = 60_000;

export function computeCapabilities(
  rawAttributes: Record<string, unknown>,
  profileReceivedAtMs: number,
): Capabilities {
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
  const hidReady =
    hidConnected === true && hidBonded === true && hidPairing !== true;
  const liveReady =
    liveSessionActive === true && pairedHostReady === true;

  const ageMs =
    profileReceivedAtMs === 0 ? Number.POSITIVE_INFINITY : Date.now() - profileReceivedAtMs;
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

  const screenW = num(profile.display_width_px, num(profile.display_width_pixels, DEFAULT_STATIC.screenWidthPx));
  const screenH = num(profile.display_height_px, num(profile.display_height_pixels, DEFAULT_STATIC.screenHeightPx));
  const density = num(profile.density, num(profile.display_scale, DEFAULT_STATIC.density));
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

/**
 * Fetch and normalize the device profile from the control plane once.
 * Returns null on failure (HTTP or network).
 */
export async function fetchDeviceProfileOnce(
  config: ZhiHandRuntimeConfig,
): Promise<{ rawAttrs: Record<string, unknown>; receivedAtMs: number } | null> {
  const url = `${config.controlPlaneEndpoint}/v1/credentials/${encodeURIComponent(config.credentialId)}/device-profile`;
  log.debug(`[device] Fetching profile: GET ${url}`);
  try {
    const response = await fetch(url, {
      headers: { "Authorization": `Bearer ${config.controllerToken}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      log.debug(`[device] Profile fetch failed: ${response.status} ${response.statusText}`);
      return null;
    }
    const data = (await response.json()) as Record<string, unknown>;
    const wrapper = (typeof data.profile === "object" && data.profile !== null)
      ? (data.profile as Record<string, unknown>)
      : data;
    const attrs = (typeof wrapper.attributes === "object" && wrapper.attributes !== null)
      ? (wrapper.attributes as Record<string, unknown>)
      : {};
    const rawAttrs = { ...attrs, platform: wrapper.platform ?? attrs.platform };
    return { rawAttrs, receivedAtMs: Date.now() };
  } catch (err) {
    log.debug(`[device] Profile fetch error: ${(err as Error).message}`);
    return null;
  }
}

/**
 * Normalize an SSE device_profile.updated payload into rawAttrs shape.
 */
export function normalizeProfilePayload(raw: Record<string, unknown>): Record<string, unknown> {
  if (typeof raw.attributes === "object" && raw.attributes !== null) {
    const attrs = raw.attributes as Record<string, unknown>;
    return { ...attrs, platform: raw.platform ?? attrs.platform };
  }
  return raw;
}

// ── Allowlist for zhihand_status raw attributes ───────────

const RAW_ATTRIBUTE_ALLOWLIST: readonly string[] = [
  "brand", "manufacturer", "model", "rom_family", "rom_version",
  "system_release", "api_level", "app_version", "app_build",
  "display_width_px", "display_height_px", "density", "density_dpi",
  "screen_width_dp", "screen_height_dp", "smallest_width_dp",
  "form_factor", "orientation", "touchscreen", "navigation_mode",
  "locale", "language", "timezone", "rtl", "dark_mode", "font_scale",
  "battery_level", "battery_state", "available_storage_mb",
  "thermal_state", "low_ram_device",
  "network_type",
  "hid_connected", "hid_bonded", "hid_pairing", "hid_session_ready",
  "live_session_active", "paired_host_ready", "recording_active",
  "recording_archive_enabled", "app_in_foreground", "task_running",
  "emergency_stop_armed", "firmware_update_in_progress",
  "hardware_keyboard_present", "hard_keyboard_hidden",
  "supports_keyboard_prompt_navigation",
];

export function pickAllowlistedRawAttributes(
  rawAttributes: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of RAW_ATTRIBUTE_ALLOWLIST) {
    if (k in rawAttributes && rawAttributes[k] !== undefined) {
      out[k] = rawAttributes[k];
    }
  }
  return out;
}

// ── Default static/dynamic export for empty-state rendering ──
export { DEFAULT_STATIC, DEFAULT_DYNAMIC };

// ── Tool descriptions (multi-device + multi-user aware) ──────

import type { DeviceState } from "./registry.ts";

function formatDeviceLabel(d: DeviceState, multiUser: boolean): string {
  return multiUser ? `[${d.userLabel}] ${d.label}` : d.label;
}

function singleDeviceOpenAppGuidance(platform: string): string {
  if (platform === "android") {
    return " For open_app, use appPackage (e.g. 'com.tencent.mm'). Do NOT send bundleId or urlScheme.";
  }
  if (platform === "ios") {
    return " For open_app, use bundleId (e.g. 'com.tencent.xin') or urlScheme (e.g. 'weixin://'). Do NOT send appPackage.";
  }
  return "";
}

export function buildControlToolDescription(
  state: DeviceState | null,
  onlineStates?: DeviceState[],
  multiUser?: boolean,
): string {
  const baseGeneric =
    "Control the connected mobile device. Supports click, swipe, type, scroll, open_app, back, home, and more. All coordinates use normalized ratios [0,1]. Call zhihand_list_devices to see online devices, then pass device_id.";
  if (onlineStates) {
    if (onlineStates.length === 0) {
      return "No devices online — ask user to open the ZhiHand app. " + baseGeneric;
    }
    if (onlineStates.length === 1) {
      const s = onlineStates[0]!;
      const ctx = s.profile;
      const label = formatDeviceLabel(s, multiUser ?? false);
      if (!ctx || ctx.platform === "unknown") {
        return `Control the connected mobile device (${label}). device_id is optional (single device online). All coordinates use normalized ratios [0,1].`;
      }
      const parts = [
        `Control a ${ctx.platform} device`,
        `(${ctx.model}, ${ctx.osVersion}`,
        `${ctx.screenWidthPx}x${ctx.screenHeightPx}`,
        `${ctx.formFactor}, ${ctx.locale})`,
      ];
      let desc = parts.join(", ") + `. device_id is optional (single device online: ${s.credentialId}).`;
      desc += " All coordinates use normalized ratios [0,1].";
      desc += singleDeviceOpenAppGuidance(ctx.platform);
      return desc;
    }
    // 2+ devices
    const ids = onlineStates.map((d) => `${d.credentialId} (${formatDeviceLabel(d, multiUser ?? false)}, ${d.platform})`).join("; ");
    return `Control a mobile device. device_id is REQUIRED (multiple online). Online devices: ${ids}. Call zhihand_list_devices first. All coordinates use normalized ratios [0,1].`;
  }
  // No explicit onlineStates: describe single state or generic
  if (!state || !state.profile || state.profile.platform === "unknown") {
    return baseGeneric;
  }
  const ctx = state.profile;
  const parts = [
    `Control a ${ctx.platform} device`,
    `(${ctx.model}, ${ctx.osVersion}`,
    `${ctx.screenWidthPx}x${ctx.screenHeightPx}`,
    `${ctx.formFactor}, ${ctx.locale})`,
  ];
  let desc = parts.join(", ") + ".";
  desc += " All coordinates use normalized ratios [0,1].";
  desc += singleDeviceOpenAppGuidance(ctx.platform);
  return desc;
}

export function buildSystemToolDescription(
  state: DeviceState | null,
  onlineStates?: DeviceState[],
  multiUser?: boolean,
): string {
  const genericBase =
    "System navigation and media controls. Actions: notification, recent, search, switch_input, siri (iOS), control_center (iOS), open_browser (Android), shortcut_help (Android), volume_up/down, mute, play_pause, stop, next/prev_track, fast_forward, rewind, brightness_up/down, power.";

  if (onlineStates) {
    if (onlineStates.length === 0) {
      return "No devices online — ask user to open the ZhiHand app. " + genericBase;
    }
    if (onlineStates.length === 1) {
      const s = onlineStates[0]!;
      const platform = s.profile?.platform ?? s.platform;
      const label = formatDeviceLabel(s, multiUser ?? false);
      const parts: string[] = [
        `System navigation and media controls for ${platform} device (${s.profile?.model ?? label}). device_id is optional (single device online).`,
      ];
      parts.push("Navigation: notification, recent, search (optional text query), switch_input.");
      if (platform === "ios") parts.push("iOS: siri, control_center.");
      else if (platform === "android") parts.push("Android: open_browser, shortcut_help.");
      parts.push("Media: volume_up, volume_down, mute, play_pause, stop, next_track, prev_track, fast_forward, rewind.");
      parts.push("Hardware: brightness_up, brightness_down, power.");
      return parts.join(" ");
    }
    const ids = onlineStates.map((d) => `${d.credentialId} (${formatDeviceLabel(d, multiUser ?? false)}, ${d.platform})`).join("; ");
    return `System navigation and media controls for mobile device. device_id is REQUIRED (multiple online). Online: ${ids}. ` + genericBase;
  }

  if (!state || !state.profile || state.profile.platform === "unknown") {
    return genericBase;
  }
  const platform = state.profile.platform;
  const parts: string[] = [
    `System navigation and media controls for ${platform} device (${state.profile.model}).`,
  ];
  parts.push("Navigation: notification, recent, search (optional text query), switch_input.");
  if (platform === "ios") parts.push("iOS: siri, control_center.");
  else if (platform === "android") parts.push("Android: open_browser, shortcut_help.");
  parts.push("Media: volume_up, volume_down, mute, play_pause, stop, next_track, prev_track, fast_forward, rewind.");
  parts.push("Hardware: brightness_up, brightness_down, power.");
  return parts.join(" ");
}

export function buildScreenshotToolDescription(
  state: DeviceState | null,
  onlineStates?: DeviceState[],
  multiUser?: boolean,
): string {
  if (onlineStates) {
    if (onlineStates.length === 0) {
      return "Take a screenshot of the phone screen. No devices online — ask user to open the ZhiHand app.";
    }
    if (onlineStates.length === 1) {
      const s = onlineStates[0]!;
      const ctx = s.profile;
      const label = formatDeviceLabel(s, multiUser ?? false);
      if (!ctx || ctx.platform === "unknown") {
        return `Take a screenshot of the phone screen (${label}). device_id is optional (single device online).`;
      }
      return `Take a screenshot of the ${ctx.platform} device (${ctx.model}, ${ctx.screenWidthPx}x${ctx.screenHeightPx}). device_id is optional (single device online).`;
    }
    const ids = onlineStates.map((d) => `${d.credentialId} (${formatDeviceLabel(d, multiUser ?? false)})`).join("; ");
    return `Take a screenshot of a mobile device. device_id is REQUIRED (multiple online). Online: ${ids}.`;
  }
  if (!state || !state.profile || state.profile.platform === "unknown") {
    return "Take a screenshot of the phone screen.";
  }
  const ctx = state.profile;
  return `Take a screenshot of the ${ctx.platform} device (${ctx.model}, ${ctx.screenWidthPx}x${ctx.screenHeightPx}).`;
}

// ── Format status for zhihand_status tool ─────────────────

export function formatDeviceStatus(state: DeviceState): Record<string, unknown> {
  const staticCtx = state.profile ?? DEFAULT_STATIC;
  const dynamicCtx = state.rawAttributes
    ? extractDynamic(state.rawAttributes)
    : DEFAULT_DYNAMIC;
  const caps = state.capabilities ?? computeCapabilities(state.rawAttributes ?? {}, state.profileReceivedAtMs);
  return {
    credential_id: state.credentialId,
    label: state.label,
    user_id: state.userId,
    user_label: state.userLabel,
    online: state.online,
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
    capabilities: caps,
    raw: pickAllowlistedRawAttributes(state.rawAttributes ?? {}),
  };
}

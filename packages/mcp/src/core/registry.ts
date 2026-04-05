/**
 * Device registry — the single source of truth for all paired devices,
 * their live state (profile, online flag, SSE connection), and multi-
 * device routing.
 *
 * Holds a per-credential AbortController for SSE, a per-device heartbeat
 * timer, and a single debounced notifier for list_changed.
 */

import {
  loadConfig,
  addDevice as configAddDevice,
  removeDevice as configRemoveDevice,
  renameDevice as configRenameDevice,
  setDefaultDevice as configSetDefault,
  updateLastSeen as configUpdateLastSeen,
  recordToRuntimeConfig,
  type DeviceRecord,
  type ZhiHandRuntimeConfig,
} from "./config.ts";
import {
  extractStatic,
  computeCapabilities,
  fetchDeviceProfileOnce,
  normalizeProfilePayload,
  type StaticContext,
  type Capabilities,
} from "./device.ts";
import { connectSSEForCredential, handleSSEEvent, type SSEEvent } from "./sse.ts";
import { dbg } from "../daemon/logger.ts";

const HEARTBEAT_INTERVAL_MS = 30_000;
const ONLINE_PROFILE_TTL_MS = 60_000;
const LIST_CHANGED_DEBOUNCE_MS = 2500;

export interface DeviceState {
  credentialId: string;
  label: string;
  platform: "ios" | "android" | "unknown";
  online: boolean;
  lastSeenAtMs: number;
  profile: StaticContext | null;
  capabilities: Capabilities | null;
  profileReceivedAtMs: number;
  rawAttributes: Record<string, unknown>;
  sseController: AbortController | null;
  sseConnected: boolean;
  heartbeatTimer: ReturnType<typeof setInterval> | null;
  record: DeviceRecord;
}

type ListChangedCb = () => void;

class Registry {
  private devices = new Map<string, DeviceState>();
  private listChangedSubs = new Set<ListChangedCb>();
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private lastOnlineSet = new Set<string>();
  private initialized = false;

  get(credentialId: string): DeviceState | null {
    return this.devices.get(credentialId) ?? null;
  }

  list(): DeviceState[] {
    return Array.from(this.devices.values());
  }

  listOnline(): DeviceState[] {
    return this.list()
      .filter((d) => d.online)
      .sort((a, b) => b.lastSeenAtMs - a.lastSeenAtMs);
  }

  /**
   * Priority:
   *   1. If the user has explicitly set a default via `zhihand default <id>`
   *      AND that device is online → return it. Honoring an explicit user
   *      preference is the least-surprising UX.
   *   2. Otherwise → most-recently-active online device (online[0] is sorted
   *      desc by lastSeenAtMs).
   *   3. No online devices → null.
   */
  resolveDefault(): DeviceState | null {
    const online = this.listOnline();
    if (online.length === 0) return null;
    const cfg = loadConfig();
    if (cfg.default_credential_id) {
      const d = this.devices.get(cfg.default_credential_id);
      if (d && d.online) return d;
    }
    return online[0]!;
  }

  toRuntimeConfig(state: DeviceState): ZhiHandRuntimeConfig {
    return recordToRuntimeConfig(state.record);
  }

  subscribe(cb: ListChangedCb): () => void {
    this.listChangedSubs.add(cb);
    return () => this.listChangedSubs.delete(cb);
  }

  private computeOnlineSet(): Set<string> {
    const out = new Set<string>();
    for (const d of this.devices.values()) {
      if (d.online) out.add(d.credentialId);
    }
    return out;
  }

  private setsEqual(a: Set<string>, b: Set<string>): boolean {
    if (a.size !== b.size) return false;
    for (const x of a) if (!b.has(x)) return false;
    return true;
  }

  private scheduleListChanged(): void {
    const now = this.computeOnlineSet();
    if (this.setsEqual(now, this.lastOnlineSet)) {
      return;
    }
    if (this.debounceTimer) return;
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      const current = this.computeOnlineSet();
      if (this.setsEqual(current, this.lastOnlineSet)) return;
      this.lastOnlineSet = current;
      for (const cb of this.listChangedSubs) {
        try { cb(); } catch { /* swallow */ }
      }
    }, LIST_CHANGED_DEBOUNCE_MS);
  }

  private updateOnlineFlag(state: DeviceState): void {
    const profileFresh = state.profileReceivedAtMs > 0 &&
      (Date.now() - state.profileReceivedAtMs) < ONLINE_PROFILE_TTL_MS;
    const newOnline = state.sseConnected && profileFresh;
    if (newOnline !== state.online) {
      state.online = newOnline;
      dbg(`[registry] ${state.credentialId} online=${newOnline}`);
      this.scheduleListChanged();
    }
  }

  private touchLastSeen(state: DeviceState): void {
    state.lastSeenAtMs = Date.now();
    const iso = new Date(state.lastSeenAtMs).toISOString();
    try {
      configUpdateLastSeen(state.credentialId, iso);
      state.record.last_seen_at = iso;
    } catch {
      // non-fatal
    }
  }

  private async refreshProfile(state: DeviceState): Promise<boolean> {
    const cfg = this.toRuntimeConfig(state);
    const result = await fetchDeviceProfileOnce(cfg);
    if (!result) {
      state.online = false;
      this.scheduleListChanged();
      return false;
    }
    state.rawAttributes = result.rawAttrs;
    state.profileReceivedAtMs = result.receivedAtMs;
    state.profile = extractStatic(result.rawAttrs);
    state.capabilities = computeCapabilities(result.rawAttrs, result.receivedAtMs);
    // Infer platform from profile
    const plat = state.profile.platform;
    if (plat === "ios" || plat === "android") {
      state.platform = plat;
      state.record.platform = plat;
    }
    this.touchLastSeen(state);
    this.updateOnlineFlag(state);
    return true;
  }

  private startHeartbeat(state: DeviceState): void {
    if (state.heartbeatTimer) return;
    state.heartbeatTimer = setInterval(() => {
      this.refreshProfile(state).catch(() => { /* already handled */ });
    }, HEARTBEAT_INTERVAL_MS);
  }

  private stopHeartbeat(state: DeviceState): void {
    if (state.heartbeatTimer) {
      clearInterval(state.heartbeatTimer);
      state.heartbeatTimer = null;
    }
  }

  private startSSE(state: DeviceState): void {
    if (state.sseController) return;
    const cfg = this.toRuntimeConfig(state);
    state.sseController = connectSSEForCredential(cfg, {
      onEvent: (ev: SSEEvent) => {
        // Dispatch command ACKs globally
        handleSSEEvent(ev);
        if (ev.kind === "device_profile.updated" && ev.device_profile) {
          const attrs = normalizeProfilePayload(ev.device_profile);
          state.rawAttributes = attrs;
          state.profileReceivedAtMs = Date.now();
          state.profile = extractStatic(attrs);
          state.capabilities = computeCapabilities(attrs, state.profileReceivedAtMs);
          const plat = state.profile.platform;
          if (plat === "ios" || plat === "android") {
            state.platform = plat;
            state.record.platform = plat;
          }
          this.touchLastSeen(state);
          this.updateOnlineFlag(state);
        } else if (ev.kind === "credential.revoked") {
          dbg(`[registry] ${state.credentialId} credential.revoked`);
          state.online = false;
          this.scheduleListChanged();
        }
      },
      onConnected: () => {
        dbg(`[registry] SSE connected: ${state.credentialId}`);
        state.sseConnected = true;
        this.updateOnlineFlag(state);
      },
      onDisconnected: () => {
        dbg(`[registry] SSE disconnected: ${state.credentialId}`);
        state.sseConnected = false;
        this.updateOnlineFlag(state);
      },
    });
  }

  private stopSSE(state: DeviceState): void {
    state.sseController?.abort();
    state.sseController = null;
    state.sseConnected = false;
  }

  private makeState(record: DeviceRecord): DeviceState {
    return {
      credentialId: record.credential_id,
      label: record.label,
      platform: record.platform,
      online: false,
      lastSeenAtMs: 0,
      profile: null,
      capabilities: null,
      profileReceivedAtMs: 0,
      rawAttributes: {},
      sseController: null,
      sseConnected: false,
      heartbeatTimer: null,
      record,
    };
  }

  async init(): Promise<void> {
    if (this.initialized) return;
    this.initialized = true;
    const cfg = loadConfig();
    const records = Object.values(cfg.devices);
    for (const r of records) {
      const s = this.makeState(r);
      this.devices.set(r.credential_id, s);
      this.startSSE(s);
      this.startHeartbeat(s);
    }
    // Fire off initial profile fetches in parallel, with overall ~5s cap
    const fetches = records.map((r) => {
      const s = this.devices.get(r.credential_id)!;
      return this.refreshProfile(s).catch(() => false);
    });
    await Promise.race([
      Promise.all(fetches),
      new Promise((r) => setTimeout(r, 5000)),
    ]);
  }

  async addDevice(record: DeviceRecord): Promise<void> {
    configAddDevice(record);
    let s = this.devices.get(record.credential_id);
    if (!s) {
      s = this.makeState(record);
      this.devices.set(record.credential_id, s);
    } else {
      s.record = record;
      s.label = record.label;
    }
    this.startSSE(s);
    this.startHeartbeat(s);
    await this.refreshProfile(s).catch(() => false);
  }

  removeDevice(credentialId: string): void {
    const s = this.devices.get(credentialId);
    if (s) {
      this.stopSSE(s);
      this.stopHeartbeat(s);
      this.devices.delete(credentialId);
    }
    configRemoveDevice(credentialId);
    this.scheduleListChanged();
  }

  renameDevice(credentialId: string, label: string): void {
    configRenameDevice(credentialId, label);
    const s = this.devices.get(credentialId);
    if (s) {
      s.label = label;
      s.record.label = label;
    }
  }

  setDefault(credentialId: string): void {
    configSetDefault(credentialId);
  }

  shutdown(): void {
    for (const s of this.devices.values()) {
      this.stopSSE(s);
      this.stopHeartbeat(s);
    }
    this.devices.clear();
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    this.listChangedSubs.clear();
    this.initialized = false;
  }
}

export const registry = new Registry();

/**
 * Device registry — the single source of truth for all paired devices,
 * their live state (profile, online flag, SSE connection), and multi-
 * device routing.
 *
 * Holds a per-credential AbortController for SSE, a per-device heartbeat
 * timer, and a single debounced notifier for list_changed.
 */
import { loadConfig, addDevice as configAddDevice, removeDevice as configRemoveDevice, renameDevice as configRenameDevice, setDefaultDevice as configSetDefault, updateLastSeen as configUpdateLastSeen, recordToRuntimeConfig, } from "./config.js";
import { extractStatic, computeCapabilities, fetchDeviceProfileOnce, normalizeProfilePayload, } from "./device.js";
import { connectSSEForCredential, handleSSEEvent } from "./sse.js";
import { dbg } from "../daemon/logger.js";
const HEARTBEAT_INTERVAL_MS = 30_000;
const ONLINE_PROFILE_TTL_MS = 60_000;
const LIST_CHANGED_DEBOUNCE_MS = 2500;
class Registry {
    devices = new Map();
    listChangedSubs = new Set();
    debounceTimer = null;
    lastOnlineSet = new Set();
    initialized = false;
    get(credentialId) {
        return this.devices.get(credentialId) ?? null;
    }
    list() {
        return Array.from(this.devices.values());
    }
    listOnline() {
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
    resolveDefault() {
        const online = this.listOnline();
        if (online.length === 0)
            return null;
        const cfg = loadConfig();
        if (cfg.default_credential_id) {
            const d = this.devices.get(cfg.default_credential_id);
            if (d && d.online)
                return d;
        }
        return online[0];
    }
    toRuntimeConfig(state) {
        return recordToRuntimeConfig(state.record);
    }
    subscribe(cb) {
        this.listChangedSubs.add(cb);
        return () => this.listChangedSubs.delete(cb);
    }
    computeOnlineSet() {
        const out = new Set();
        for (const d of this.devices.values()) {
            if (d.online)
                out.add(d.credentialId);
        }
        return out;
    }
    setsEqual(a, b) {
        if (a.size !== b.size)
            return false;
        for (const x of a)
            if (!b.has(x))
                return false;
        return true;
    }
    scheduleListChanged() {
        const now = this.computeOnlineSet();
        if (this.setsEqual(now, this.lastOnlineSet)) {
            return;
        }
        if (this.debounceTimer)
            return;
        this.debounceTimer = setTimeout(() => {
            this.debounceTimer = null;
            const current = this.computeOnlineSet();
            if (this.setsEqual(current, this.lastOnlineSet))
                return;
            this.lastOnlineSet = current;
            for (const cb of this.listChangedSubs) {
                try {
                    cb();
                }
                catch { /* swallow */ }
            }
        }, LIST_CHANGED_DEBOUNCE_MS);
    }
    updateOnlineFlag(state) {
        const profileFresh = state.profileReceivedAtMs > 0 &&
            (Date.now() - state.profileReceivedAtMs) < ONLINE_PROFILE_TTL_MS;
        const newOnline = state.sseConnected && profileFresh;
        if (newOnline !== state.online) {
            state.online = newOnline;
            dbg(`[registry] ${state.credentialId} online=${newOnline}`);
            this.scheduleListChanged();
        }
    }
    touchLastSeen(state) {
        state.lastSeenAtMs = Date.now();
        const iso = new Date(state.lastSeenAtMs).toISOString();
        try {
            configUpdateLastSeen(state.credentialId, iso);
            state.record.last_seen_at = iso;
        }
        catch {
            // non-fatal
        }
    }
    async refreshProfile(state) {
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
    startHeartbeat(state) {
        if (state.heartbeatTimer)
            return;
        state.heartbeatTimer = setInterval(() => {
            this.refreshProfile(state).catch(() => { });
        }, HEARTBEAT_INTERVAL_MS);
    }
    stopHeartbeat(state) {
        if (state.heartbeatTimer) {
            clearInterval(state.heartbeatTimer);
            state.heartbeatTimer = null;
        }
    }
    startSSE(state) {
        if (state.sseController)
            return;
        const cfg = this.toRuntimeConfig(state);
        state.sseController = connectSSEForCredential(cfg, {
            onEvent: (ev) => {
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
                }
                else if (ev.kind === "credential.revoked") {
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
    stopSSE(state) {
        state.sseController?.abort();
        state.sseController = null;
        state.sseConnected = false;
    }
    makeState(record) {
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
    async init() {
        if (this.initialized)
            return;
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
            const s = this.devices.get(r.credential_id);
            return this.refreshProfile(s).catch(() => false);
        });
        await Promise.race([
            Promise.all(fetches),
            new Promise((r) => setTimeout(r, 5000)),
        ]);
    }
    async addDevice(record) {
        configAddDevice(record);
        let s = this.devices.get(record.credential_id);
        if (!s) {
            s = this.makeState(record);
            this.devices.set(record.credential_id, s);
        }
        else {
            s.record = record;
            s.label = record.label;
        }
        this.startSSE(s);
        this.startHeartbeat(s);
        await this.refreshProfile(s).catch(() => false);
    }
    removeDevice(credentialId) {
        const s = this.devices.get(credentialId);
        if (s) {
            this.stopSSE(s);
            this.stopHeartbeat(s);
            this.devices.delete(credentialId);
        }
        configRemoveDevice(credentialId);
        this.scheduleListChanged();
    }
    renameDevice(credentialId, label) {
        configRenameDevice(credentialId, label);
        const s = this.devices.get(credentialId);
        if (s) {
            s.label = label;
            s.record.label = label;
        }
    }
    setDefault(credentialId) {
        configSetDefault(credentialId);
    }
    shutdown() {
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

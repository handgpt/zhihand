/**
 * Device registry — the single source of truth for all paired devices,
 * their live state, and multi-user WebSocket streams.
 *
 * Groups devices under users. Each user has one UserEventWebSocket.
 * Online detection is server-authoritative (no local heartbeat polling).
 * Config hot-reload via fs.watchFile.
 */
import fs from "node:fs";
import { loadConfig, getConfigPath, resolveDefaultEndpoint, addDeviceToUser as configAddDeviceToUser, updateDeviceLastSeen as configUpdateDeviceLastSeen, } from "./config.js";
import { extractStatic, computeCapabilities, normalizeProfilePayload, } from "./device.js";
import { UserEventWebSocket, fetchUserCredentials, } from "./ws.js";
import { log } from "./logger.js";
const LIST_CHANGED_DEBOUNCE_MS = 2500;
const CONFIG_WATCH_INTERVAL_MS = 1000;
const CONFIG_RECONCILE_DEBOUNCE_MS = 300;
class Registry {
    userStates = new Map();
    listChangedSubs = new Set();
    debounceTimer = null;
    lastOnlineSet = new Set();
    initialized = false;
    configWatchActive = false;
    reconcileTimer = null;
    // ── Public API ──────────────────────────────────────────
    get(credentialId) {
        for (const us of this.userStates.values()) {
            const d = us.devices.get(credentialId);
            if (d)
                return d;
        }
        return null;
    }
    list() {
        const all = [];
        for (const us of this.userStates.values()) {
            for (const d of us.devices.values()) {
                all.push(d);
            }
        }
        return all;
    }
    listOnline() {
        return this.list()
            .filter((d) => d.online)
            .sort((a, b) => b.lastSeenAtMs - a.lastSeenAtMs);
    }
    /**
     * Most-recently-active online device across all users.
     */
    resolveDefault() {
        const online = this.listOnline();
        return online.length > 0 ? online[0] : null;
    }
    isMultiUser() {
        return this.userStates.size > 1;
    }
    toRuntimeConfig(state) {
        const us = this.userStates.get(state.userId);
        return {
            controlPlaneEndpoint: us?.endpoint ?? resolveDefaultEndpoint(),
            credentialId: state.credentialId,
            controllerToken: us?.controllerToken ?? "",
            timeoutMs: 10_000,
        };
    }
    subscribe(cb) {
        this.listChangedSubs.add(cb);
        return () => this.listChangedSubs.delete(cb);
    }
    // ── Init / Shutdown ────────────────────────────────────
    async init() {
        if (this.initialized)
            return;
        this.initialized = true;
        const cfg = loadConfig();
        const endpoint = resolveDefaultEndpoint();
        const users = Object.values(cfg.users);
        // Create user states and start WS streams
        const fetchPromises = [];
        for (const userRec of users) {
            const us = this.createUserState(userRec, endpoint);
            this.userStates.set(userRec.user_id, us);
            this.startUserStream(us);
            // Fetch initial credentials with online status
            fetchPromises.push(this.fetchAndPopulateDevices(us, userRec).catch(() => {
                // Non-fatal: populate from config alone
                this.populateDevicesFromConfig(us, userRec);
            }));
        }
        // Overall 5s cap on initial fetches
        await Promise.race([
            Promise.all(fetchPromises),
            new Promise((r) => setTimeout(r, 5000)),
        ]);
        // Start config hot-reload watcher
        this.startConfigWatch();
    }
    shutdown() {
        for (const us of this.userStates.values()) {
            us.stream?.stop();
            us.stream = null;
        }
        this.userStates.clear();
        if (this.debounceTimer) {
            clearTimeout(this.debounceTimer);
            this.debounceTimer = null;
        }
        if (this.reconcileTimer) {
            clearTimeout(this.reconcileTimer);
            this.reconcileTimer = null;
        }
        this.stopConfigWatch();
        this.listChangedSubs.clear();
        this.initialized = false;
    }
    // ── Online set change detection ─────────────────────────
    computeOnlineSet() {
        const out = new Set();
        for (const us of this.userStates.values()) {
            for (const d of us.devices.values()) {
                if (d.online)
                    out.add(d.credentialId);
            }
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
        if (this.setsEqual(now, this.lastOnlineSet))
            return;
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
    // ── User/Device state management ───────────────────────
    createUserState(userRec, endpoint) {
        return {
            userId: userRec.user_id,
            controllerToken: userRec.controller_token,
            label: userRec.label,
            endpoint,
            stream: null,
            devices: new Map(),
        };
    }
    makeDeviceState(record, userId, userLabel, online = false) {
        return {
            credentialId: record.credential_id,
            userId,
            userLabel,
            label: record.label,
            platform: record.platform,
            online,
            lastSeenAtMs: 0,
            profile: null,
            capabilities: null,
            profileReceivedAtMs: 0,
            rawAttributes: {},
            record,
        };
    }
    populateDevicesFromConfig(us, userRec) {
        for (const dev of userRec.devices) {
            if (!us.devices.has(dev.credential_id)) {
                us.devices.set(dev.credential_id, this.makeDeviceState(dev, us.userId, us.label));
            }
        }
    }
    async fetchAndPopulateDevices(us, userRec) {
        const creds = await fetchUserCredentials(us.endpoint, us.userId, us.controllerToken);
        // Populate from server response (has online status)
        for (const cred of creds) {
            const existing = us.devices.get(cred.credential_id);
            if (existing) {
                existing.online = cred.online ?? false;
                if (cred.online) {
                    existing.lastSeenAtMs = Date.now();
                }
            }
            else {
                const record = {
                    credential_id: cred.credential_id,
                    label: cred.label ?? cred.credential_id,
                    platform: cred.platform ?? "unknown",
                    paired_at: cred.paired_at ?? new Date().toISOString(),
                    last_seen_at: cred.last_seen_at ?? new Date().toISOString(),
                };
                const state = this.makeDeviceState(record, us.userId, us.label, cred.online ?? false);
                if (cred.online)
                    state.lastSeenAtMs = Date.now();
                us.devices.set(cred.credential_id, state);
            }
        }
        // Also ensure all config devices are present
        this.populateDevicesFromConfig(us, userRec);
    }
    // ── WS stream management ──────────────────────────────
    startUserStream(us) {
        if (us.stream)
            return;
        us.stream = new UserEventWebSocket(us.userId, us.controllerToken, us.endpoint, {
            onDeviceOnline: (credentialId) => {
                const d = us.devices.get(credentialId);
                if (d) {
                    d.online = true;
                    d.lastSeenAtMs = Date.now();
                    this.touchLastSeen(d);
                    log.debug(`[registry] ${credentialId} online`);
                    this.scheduleListChanged();
                }
            },
            onDeviceOffline: (credentialId) => {
                const d = us.devices.get(credentialId);
                if (d) {
                    d.online = false;
                    log.debug(`[registry] ${credentialId} offline`);
                    this.scheduleListChanged();
                }
            },
            onDeviceProfileUpdated: (credentialId, profile) => {
                const d = us.devices.get(credentialId);
                if (d) {
                    const attrs = normalizeProfilePayload(profile);
                    d.rawAttributes = attrs;
                    d.profileReceivedAtMs = Date.now();
                    d.profile = extractStatic(attrs);
                    d.capabilities = computeCapabilities(attrs, d.profileReceivedAtMs);
                    const plat = d.profile.platform;
                    if (plat === "ios" || plat === "android") {
                        d.platform = plat;
                        d.record.platform = plat;
                    }
                    this.touchLastSeen(d);
                }
            },
            onCommandAcked: (event) => {
                // Already handled by handleWSEvent in the stream dispatch
            },
            onCredentialAdded: (credential) => {
                const credId = credential.credential_id;
                if (credId && !us.devices.has(credId)) {
                    const record = {
                        credential_id: credId,
                        label: credential.label ?? credId,
                        platform: (credential.platform ?? "unknown"),
                        paired_at: credential.paired_at ?? new Date().toISOString(),
                        last_seen_at: new Date().toISOString(),
                    };
                    const state = this.makeDeviceState(record, us.userId, us.label, true);
                    state.lastSeenAtMs = Date.now();
                    us.devices.set(credId, state);
                    // Persist to config immediately so fs.watchFile reconciliation
                    // doesn't wipe this device before the pairing CLI writes it.
                    try {
                        configAddDeviceToUser(us.userId, record);
                    }
                    catch {
                        // non-fatal — pairing CLI will persist shortly
                    }
                    this.scheduleListChanged();
                }
            },
            onCredentialRemoved: (credentialId) => {
                us.devices.delete(credentialId);
                this.scheduleListChanged();
            },
            onConnected: () => {
                log.debug(`[registry] WS connected for user ${us.userId}`);
                // Re-fetch credentials to reconcile missed events
                fetchUserCredentials(us.endpoint, us.userId, us.controllerToken)
                    .then((creds) => {
                    const onlineIds = new Set(creds.filter((c) => c.online).map((c) => c.credential_id));
                    for (const d of us.devices.values()) {
                        const wasOnline = d.online;
                        d.online = onlineIds.has(d.credentialId);
                        if (d.online)
                            d.lastSeenAtMs = Date.now();
                        if (wasOnline !== d.online) {
                            this.scheduleListChanged();
                        }
                    }
                })
                    .catch(() => { });
            },
            onDisconnected: () => {
                log.debug(`[registry] WS disconnected for user ${us.userId}`);
            },
        });
        us.stream.start();
    }
    touchLastSeen(state) {
        state.lastSeenAtMs = Date.now();
        const iso = new Date(state.lastSeenAtMs).toISOString();
        try {
            configUpdateDeviceLastSeen(state.userId, state.credentialId, iso);
            state.record.last_seen_at = iso;
        }
        catch {
            // non-fatal
        }
    }
    // ── Config hot-reload ─────────────────────────────────
    startConfigWatch() {
        if (this.configWatchActive)
            return;
        this.configWatchActive = true;
        const configPath = getConfigPath();
        try {
            fs.watchFile(configPath, { interval: CONFIG_WATCH_INTERVAL_MS }, () => {
                // Debounce reconciliation
                if (this.reconcileTimer)
                    clearTimeout(this.reconcileTimer);
                this.reconcileTimer = setTimeout(() => {
                    this.reconcileTimer = null;
                    this.reconcileConfig();
                }, CONFIG_RECONCILE_DEBOUNCE_MS);
            });
        }
        catch {
            // watchFile not available — skip hot-reload
        }
    }
    stopConfigWatch() {
        if (!this.configWatchActive)
            return;
        this.configWatchActive = false;
        try {
            fs.unwatchFile(getConfigPath());
        }
        catch {
            // ignore
        }
    }
    reconcileConfig() {
        const cfg = loadConfig();
        const endpoint = resolveDefaultEndpoint();
        const configUserIds = new Set(Object.keys(cfg.users));
        // Remove users no longer in config
        for (const [userId, us] of this.userStates) {
            if (!configUserIds.has(userId)) {
                us.stream?.stop();
                us.stream = null;
                this.userStates.delete(userId);
                log.debug(`[registry] Removed user ${userId} (config hot-reload)`);
            }
        }
        // Add new users / reconcile devices
        for (const userRec of Object.values(cfg.users)) {
            let us = this.userStates.get(userRec.user_id);
            if (!us) {
                // New user
                us = this.createUserState(userRec, endpoint);
                this.userStates.set(userRec.user_id, us);
                this.populateDevicesFromConfig(us, userRec);
                this.startUserStream(us);
                log.debug(`[registry] Added user ${userRec.user_id} (config hot-reload)`);
            }
            else {
                // Update token/label if changed
                us.controllerToken = userRec.controller_token;
                us.label = userRec.label;
                // Reconcile devices
                const configDevIds = new Set(userRec.devices.map((d) => d.credential_id));
                // Remove devices no longer in config — but keep online devices
                // that were added via WS credential.added but not yet persisted
                // by the pairing CLI (race window).
                for (const credId of us.devices.keys()) {
                    if (!configDevIds.has(credId)) {
                        const d = us.devices.get(credId);
                        if (d && d.online) {
                            log.debug(`[registry] Keeping online device ${credId} despite missing from config`);
                            continue;
                        }
                        us.devices.delete(credId);
                    }
                }
                // Add new devices
                for (const dev of userRec.devices) {
                    if (!us.devices.has(dev.credential_id)) {
                        us.devices.set(dev.credential_id, this.makeDeviceState(dev, us.userId, us.label));
                    }
                    else {
                        // Update label/platform from config
                        const d = us.devices.get(dev.credential_id);
                        d.label = dev.label;
                        d.userLabel = us.label;
                    }
                }
            }
        }
        this.scheduleListChanged();
    }
}
export const registry = new Registry();

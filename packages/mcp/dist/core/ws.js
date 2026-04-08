/**
 * WebSocket transport — replaces SSE for all real-time event streams.
 *
 * Provides:
 *   - ReconnectingWebSocket: shared base with exponential backoff + jitter,
 *     protocol-level ping/pong watchdog, and Bearer auth via HTTP upgrade header.
 *   - UserEventWebSocket: per-user stream for device registry events.
 *   - Command ACK infrastructure (handleWSEvent, subscribeToCommandAck, waitForCommandAck).
 *   - fetchUserCredentials: HTTP REST helper (unchanged from sse.ts).
 */
import WebSocket from "ws";
import { log } from "./logger.js";
// ── Shared reconnecting base ─────────────────────────────
const BACKOFF_INITIAL_MS = 1000;
const BACKOFF_MAX_MS = 30_000;
const WATCHDOG_TIMEOUT_MS = 35_000; // slightly > server ping interval (expect ~30s)
export class ReconnectingWebSocket {
    opts;
    ws = null;
    backoffMs = BACKOFF_INITIAL_MS;
    aborted = false;
    watchdogTimer = null;
    reconnectTimer = null;
    hadOpen = false;
    consecutiveFailures = 0;
    static MAX_CONSECUTIVE_FAILURES = 10;
    constructor(opts) {
        this.opts = opts;
    }
    start() {
        this.aborted = false;
        this.connect();
    }
    stop() {
        this.aborted = true;
        this.clearWatchdog();
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }
        if (this.ws) {
            this.ws.removeAllListeners();
            if (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING) {
                this.ws.close(4000, "client shutdown");
            }
            this.ws = null;
        }
    }
    send(data) {
        if (this.ws?.readyState === WebSocket.OPEN) {
            this.ws.send(data);
        }
    }
    get connected() {
        return this.ws?.readyState === WebSocket.OPEN;
    }
    connect() {
        if (this.aborted)
            return;
        try {
            this.ws = new WebSocket(this.opts.url, {
                headers: this.opts.headers,
            });
        }
        catch (err) {
            log.error(`[ws] Failed to create WebSocket: ${err.message}`);
            this.scheduleReconnect();
            return;
        }
        this.ws.on("open", () => {
            this.hadOpen = true;
            this.consecutiveFailures = 0;
            this.backoffMs = BACKOFF_INITIAL_MS;
            this.resetWatchdog();
            this.opts.onOpen?.();
        });
        this.ws.on("message", (raw) => {
            this.resetWatchdog();
            try {
                const data = JSON.parse(raw.toString());
                this.opts.onMessage?.(data);
            }
            catch {
                // malformed message — ignore
            }
        });
        this.ws.on("ping", () => {
            // Protocol-level ping from server — ws lib auto-sends pong.
            // Reset watchdog on any activity.
            this.resetWatchdog();
        });
        this.ws.on("close", (code, reason) => {
            this.clearWatchdog();
            const reasonStr = reason.toString();
            // Detect HTTP upgrade rejection (401/403 → close 1006 without prior open)
            if (!this.hadOpen) {
                this.consecutiveFailures++;
                if (this.consecutiveFailures >= ReconnectingWebSocket.MAX_CONSECUTIVE_FAILURES) {
                    log.error(`[ws] ${this.consecutiveFailures} consecutive connection failures — stopping retries (likely auth rejection)`);
                    this.opts.onClose?.(code, reasonStr);
                    return; // Don't reconnect
                }
            }
            this.hadOpen = false;
            this.opts.onClose?.(code, reasonStr);
            if (!this.aborted && code !== 4001) {
                // Don't reconnect on explicit auth failure (4001)
                this.scheduleReconnect();
            }
        });
        this.ws.on("error", (err) => {
            this.opts.onError?.(err);
        });
    }
    scheduleReconnect() {
        if (this.aborted)
            return;
        // Jitter: ±25% of current backoff
        const jitter = this.backoffMs * 0.25 * (Math.random() * 2 - 1);
        const delay = Math.round(this.backoffMs + jitter);
        this.reconnectTimer = setTimeout(() => {
            this.reconnectTimer = null;
            this.backoffMs = Math.min(this.backoffMs * 2, BACKOFF_MAX_MS);
            this.connect();
        }, delay);
    }
    resetWatchdog() {
        this.clearWatchdog();
        this.watchdogTimer = setTimeout(() => {
            log.warn("[ws] Watchdog timeout — no activity in 35s, reconnecting");
            if (this.ws) {
                this.ws.removeAllListeners();
                this.ws.close(4000, "watchdog timeout");
                this.ws = null;
            }
            this.opts.onClose?.(4000, "watchdog timeout");
            this.scheduleReconnect();
        }, WATCHDOG_TIMEOUT_MS);
    }
    clearWatchdog() {
        if (this.watchdogTimer) {
            clearTimeout(this.watchdogTimer);
            this.watchdogTimer = null;
        }
    }
}
// ── Command ACK infrastructure (migrated from sse.ts) ────
const ackCallbacks = new Map();
export function handleWSEvent(event) {
    log.debug(`[ws-cmd] Event: kind=${event.kind}, command=${event.command?.id ?? "-"}`);
    if (event.kind === "command.acked" && event.command) {
        const callback = ackCallbacks.get(event.command.id);
        if (callback) {
            log.debug(`[ws-cmd] ACK callback for ${event.command.id}, ack_status=${event.command.ack_status}, ack_result=${JSON.stringify(event.command.ack_result ?? null)}`);
            callback(event.command);
            ackCallbacks.delete(event.command.id);
        }
    }
}
export function subscribeToCommandAck(commandId, callback) {
    ackCallbacks.set(commandId, callback);
    return () => { ackCallbacks.delete(commandId); };
}
export class UserEventWebSocket {
    controllerToken;
    handlers;
    rws;
    lastProcessedSeq = new Map();
    constructor(userId, controllerToken, endpoint, handlers) {
        this.controllerToken = controllerToken;
        this.handlers = handlers;
        const topics = ["commands", "device_profile", "device.online", "device.offline", "credential.added", "credential.removed"];
        const wsUrl = `${endpoint.replace(/^http/, "ws")}/v1/users/${encodeURIComponent(userId)}/ws`;
        this.rws = new ReconnectingWebSocket({
            url: wsUrl,
            headers: { "Authorization": `Bearer ${controllerToken}` },
            onOpen: () => {
                // Send auth message as the server requires it as the first frame.
                this.rws.send(JSON.stringify({
                    type: "auth",
                    bearer: this.controllerToken,
                    topics,
                }));
                // onConnected is called after auth_ok is received (see handleMessage)
            },
            onClose: (_code, _reason) => {
                this.handlers.onDisconnected();
            },
            onMessage: (data) => {
                this.handleMessage(data);
            },
            onError: (err) => {
                log.error(`[ws] UserEventWebSocket error: ${err.message}`);
            },
        });
    }
    get connected() {
        return this.rws.connected;
    }
    start() {
        this.rws.start();
    }
    stop() {
        this.rws.stop();
    }
    handleMessage(data) {
        const msg = data;
        // Application-level ping (if server sends these alongside protocol pings)
        if (msg.type === "ping") {
            this.rws.send(JSON.stringify({ type: "pong" }));
            return;
        }
        // Auth responses
        if (msg.type === "auth_ok") {
            this.handlers.onConnected();
            return;
        }
        if (msg.type === "auth_error") {
            log.error(`[ws] Auth failed: ${msg.error}`);
            this.rws.stop(); // Don't retry with invalid credentials
            this.handlers.onDisconnected();
            return;
        }
        // Event dispatch
        if (msg.type === "event" || msg.kind) {
            const ev = msg;
            this.dispatchEvent(ev);
        }
    }
    dispatchEvent(ev) {
        // Sequence dedup per credential
        if (ev.credential_id && ev.sequence != null) {
            const lastSeq = this.lastProcessedSeq.get(ev.credential_id) ?? -1;
            if (ev.sequence <= lastSeq)
                return;
            this.lastProcessedSeq.set(ev.credential_id, ev.sequence);
        }
        // Global command ACK dispatch
        handleWSEvent(ev);
        switch (ev.kind) {
            case "device.online":
                this.handlers.onDeviceOnline(ev.credential_id);
                break;
            case "device.offline":
                this.handlers.onDeviceOffline(ev.credential_id);
                break;
            case "device_profile.updated":
                if (ev.device_profile) {
                    this.handlers.onDeviceProfileUpdated(ev.credential_id, ev.device_profile);
                }
                break;
            case "command.acked":
                this.handlers.onCommandAcked(ev);
                break;
            case "credential.added":
                this.handlers.onCredentialAdded(ev.credential ?? ev.payload ?? { credential_id: ev.credential_id });
                break;
            case "credential.removed":
                this.handlers.onCredentialRemoved(ev.credential_id);
                break;
        }
    }
}
export async function fetchUserCredentials(endpoint, userId, controllerToken, onlineFilter) {
    let url = `${endpoint}/v1/users/${encodeURIComponent(userId)}/credentials`;
    if (onlineFilter !== undefined) {
        url += `?online=${onlineFilter}`;
    }
    const response = await fetch(url, {
        headers: { "Authorization": `Bearer ${controllerToken}` },
        signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
        throw new Error(`Fetch credentials failed: ${response.status}`);
    }
    const data = (await response.json());
    return data.items ?? [];
}
/**
 * Wait for command ACK via WS push (which should already be connected by the
 * registry). WS-only — no polling fallback.
 */
export async function waitForCommandAck(_config, options) {
    const timeoutMs = options.timeoutMs ?? 15_000;
    log.debug(`[ws-cmd] Waiting for ACK: commandId=${options.commandId}, timeout=${timeoutMs}ms`);
    const t0 = Date.now();
    return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
            log.debug(`[ws-cmd] ACK timeout: commandId=${options.commandId} after ${Date.now() - t0}ms`);
            cleanup();
            resolve({ acked: false });
        }, timeoutMs);
        const unsubscribe = subscribeToCommandAck(options.commandId, (ackedCommand) => {
            log.debug(`[ws-cmd] ACK received: commandId=${options.commandId} status=${ackedCommand.ack_status ?? "ok"} ${Date.now() - t0}ms`);
            cleanup();
            resolve({ acked: true, command: ackedCommand });
        });
        options.signal?.addEventListener("abort", () => {
            cleanup();
            reject(new Error("The operation was aborted"));
        }, { once: true });
        function cleanup() {
            clearTimeout(timeout);
            unsubscribe();
        }
    });
}

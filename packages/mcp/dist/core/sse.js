import { getCommand } from "./command.js";
import { log } from "./logger.js";
// Per-commandId callback registry for SSE-based ACK (global — ids are globally unique)
const ackCallbacks = new Map();
export function handleSSEEvent(event) {
    log.debug(`[sse-cmd] Event: kind=${event.kind}, command=${event.command?.id ?? "-"}`);
    if (event.kind === "command.acked" && event.command) {
        const callback = ackCallbacks.get(event.command.id);
        if (callback) {
            log.debug(`[sse-cmd] ACK callback for ${event.command.id}, ack_status=${event.command.ack_status}, ack_result=${JSON.stringify(event.command.ack_result ?? null)}`);
            callback(event.command);
            ackCallbacks.delete(event.command.id);
        }
    }
}
export function subscribeToCommandAck(commandId, callback) {
    ackCallbacks.set(commandId, callback);
    return () => { ackCallbacks.delete(commandId); };
}
export class UserEventStream {
    userId;
    controllerToken;
    endpoint;
    handlers;
    abortController = null;
    _connected = false;
    constructor(userId, controllerToken, endpoint, handlers) {
        this.userId = userId;
        this.controllerToken = controllerToken;
        this.endpoint = endpoint;
        this.handlers = handlers;
    }
    get connected() {
        return this._connected;
    }
    start() {
        if (this.abortController)
            return;
        this.abortController = new AbortController();
        this.runLoop(this.abortController.signal);
    }
    stop() {
        this.abortController?.abort();
        this.abortController = null;
        this._connected = false;
    }
    async runLoop(signal) {
        let backoffMs = 1000;
        const BACKOFF_MAX = 30_000;
        const topics = "commands,device_profile,device.online,device.offline,credential.added,credential.removed";
        const url = `${this.endpoint}/v1/users/${encodeURIComponent(this.userId)}/events/stream?topic=${topics}`;
        while (!signal.aborted) {
            try {
                const response = await fetch(url, {
                    headers: {
                        "Accept": "text/event-stream",
                        "Authorization": `Bearer ${this.controllerToken}`,
                    },
                    signal,
                });
                if (!response.ok) {
                    throw new Error(`SSE connect failed: ${response.status}`);
                }
                this._connected = true;
                this.handlers.onConnected();
                backoffMs = 1000;
                const reader = response.body?.getReader();
                if (!reader)
                    throw new Error("No response body for SSE");
                const decoder = new TextDecoder();
                let buffer = "";
                let eventData = "";
                while (!signal.aborted) {
                    const { done, value } = await reader.read();
                    if (done)
                        break;
                    buffer += decoder.decode(value, { stream: true });
                    const lines = buffer.split("\n");
                    buffer = lines.pop() ?? "";
                    for (const line of lines) {
                        if (line.startsWith("data: ")) {
                            eventData += (eventData ? "\n" : "") + line.slice(6);
                        }
                        else if (line === "" && eventData) {
                            try {
                                const ev = JSON.parse(eventData);
                                this.dispatchEvent(ev);
                            }
                            catch {
                                // malformed, skip
                            }
                            eventData = "";
                        }
                    }
                }
            }
            catch (err) {
                if (signal.aborted)
                    break;
                this._connected = false;
                this.handlers.onDisconnected();
                await new Promise((r) => setTimeout(r, backoffMs));
                backoffMs = Math.min(backoffMs * 2, BACKOFF_MAX);
            }
        }
        this._connected = false;
        this.handlers.onDisconnected();
    }
    dispatchEvent(ev) {
        // Always dispatch command ACKs globally
        handleSSEEvent(ev);
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
                // The credential.added event carries the new credential metadata
                // in ev.credential (with credential_id, label, platform, etc.).
                // Fall back to the root event if ev.credential is absent, since
                // credential_id is always on the root SSEEvent.
                this.handlers.onCredentialAdded(ev.credential ?? { credential_id: ev.credential_id });
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
 * Wait for command ACK via SSE push (which should already be connected by the
 * registry). Falls back to polling.
 */
export async function waitForCommandAck(config, options) {
    const timeoutMs = options.timeoutMs ?? 15_000;
    log.debug(`[sse-cmd] Waiting for ACK: commandId=${options.commandId}, timeout=${timeoutMs}ms`);
    return new Promise((resolve, reject) => {
        let resolved = false;
        let pollInterval;
        const timeout = setTimeout(() => {
            cleanup();
            resolve({ acked: false });
        }, timeoutMs);
        const unsubscribe = subscribeToCommandAck(options.commandId, (ackedCommand) => {
            if (resolved)
                return;
            resolved = true;
            cleanup();
            resolve({ acked: true, command: ackedCommand });
        });
        // Delay polling startup by 2s so SSE push ACK normally wins in the
        // registry-connected path. CLI (zhihand test) still resolves via polling
        // after the initial delay. This avoids hammering the backend with 500ms
        // HTTP polls for every command when SSE is healthy.
        const POLL_START_DELAY_MS = 2000;
        const POLL_INTERVAL_MS = 500;
        const startPolling = setTimeout(() => {
            if (resolved)
                return;
            pollInterval = setInterval(async () => {
                if (resolved)
                    return;
                try {
                    const cmd = await getCommand(config, options.commandId);
                    if (cmd.acked_at) {
                        resolved = true;
                        cleanup();
                        resolve({ acked: true, command: cmd });
                    }
                }
                catch {
                    // non-fatal
                }
            }, POLL_INTERVAL_MS);
        }, POLL_START_DELAY_MS);
        options.signal?.addEventListener("abort", () => {
            cleanup();
            reject(new Error("The operation was aborted"));
        }, { once: true });
        function cleanup() {
            clearTimeout(timeout);
            clearTimeout(startPolling);
            unsubscribe();
            if (pollInterval)
                clearInterval(pollInterval);
        }
    });
}

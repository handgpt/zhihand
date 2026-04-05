import { getCommand } from "./command.js";
import { dbg } from "../daemon/logger.js";
// Per-commandId callback registry for SSE-based ACK (global — ids are globally unique)
const ackCallbacks = new Map();
export function handleSSEEvent(event) {
    dbg(`[sse-cmd] Event: kind=${event.kind}, command=${event.command?.id ?? "-"}`);
    if (event.kind === "command.acked" && event.command) {
        const callback = ackCallbacks.get(event.command.id);
        if (callback) {
            dbg(`[sse-cmd] ACK callback for ${event.command.id}, ack_status=${event.command.ack_status}, ack_result=${JSON.stringify(event.command.ack_result ?? null)}`);
            callback(event.command);
            ackCallbacks.delete(event.command.id);
        }
    }
}
export function subscribeToCommandAck(commandId, callback) {
    ackCallbacks.set(commandId, callback);
    return () => { ackCallbacks.delete(commandId); };
}
/**
 * Open a per-credential SSE connection. Caller owns the returned AbortController.
 * The loop auto-reconnects with exponential backoff until aborted.
 */
export function connectSSEForCredential(config, handlers) {
    const controller = new AbortController();
    const { signal } = controller;
    const url = `${config.controlPlaneEndpoint}/v1/credentials/${encodeURIComponent(config.credentialId)}/events/stream`;
    let backoffMs = 1000;
    const BACKOFF_MAX = 30_000;
    (async () => {
        while (!signal.aborted) {
            try {
                const response = await fetch(url, {
                    headers: {
                        "Accept": "text/event-stream",
                        "x-zhihand-controller-token": config.controllerToken,
                    },
                    signal,
                });
                if (!response.ok) {
                    throw new Error(`SSE connect failed: ${response.status}`);
                }
                handlers.onConnected();
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
                                handlers.onEvent(ev);
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
                handlers.onDisconnected();
                await new Promise((r) => setTimeout(r, backoffMs));
                backoffMs = Math.min(backoffMs * 2, BACKOFF_MAX);
            }
        }
        handlers.onDisconnected();
    })();
    return controller;
}
/**
 * Wait for command ACK via SSE push (which should already be connected by the
 * registry). Falls back to polling.
 */
export async function waitForCommandAck(config, options) {
    const timeoutMs = options.timeoutMs ?? 15_000;
    dbg(`[sse-cmd] Waiting for ACK: commandId=${options.commandId}, timeout=${timeoutMs}ms`);
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

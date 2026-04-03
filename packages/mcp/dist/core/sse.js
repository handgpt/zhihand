import { getCommand } from "./command.js";
import { dbg } from "../daemon/logger.js";
// Per-commandId callback registry for SSE-based ACK
const ackCallbacks = new Map();
// Active SSE connection state
let sseAbortController = null;
let sseConnected = false;
export function handleSSEEvent(event) {
    dbg(`[sse-cmd] Event: kind=${event.kind}, command=${event.command?.id ?? "-"}`);
    if (event.kind === "command.acked" && event.command) {
        const callback = ackCallbacks.get(event.command.id);
        if (callback) {
            dbg(`[sse-cmd] ACK callback for ${event.command.id}, ack_status=${event.command.ack_status}`);
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
 * Connect to the SSE event stream for command ACKs.
 * Maintains a persistent connection that dispatches events to registered callbacks.
 * Reconnects automatically on connection loss.
 */
export function connectSSE(config) {
    if (sseAbortController)
        return; // Already connected
    sseAbortController = new AbortController();
    const { signal } = sseAbortController;
    const url = `${config.controlPlaneEndpoint}/v1/credentials/${encodeURIComponent(config.credentialId)}/events/stream?topic=commands`;
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
                sseConnected = true;
                const reader = response.body?.getReader();
                if (!reader)
                    throw new Error("No response body for SSE");
                const decoder = new TextDecoder();
                let buffer = "";
                while (!signal.aborted) {
                    const { done, value } = await reader.read();
                    if (done)
                        break;
                    buffer += decoder.decode(value, { stream: true });
                    const lines = buffer.split("\n");
                    buffer = lines.pop() ?? "";
                    let eventData = "";
                    for (const line of lines) {
                        if (line.startsWith("data: ")) {
                            eventData += line.slice(6);
                        }
                        else if (line === "" && eventData) {
                            try {
                                const event = JSON.parse(eventData);
                                handleSSEEvent(event);
                            }
                            catch {
                                // Malformed event, skip
                            }
                            eventData = "";
                        }
                    }
                }
            }
            catch (err) {
                if (signal.aborted)
                    break;
                sseConnected = false;
                // Backoff before reconnect
                await new Promise((r) => setTimeout(r, 3000));
            }
        }
        sseConnected = false;
    })();
}
/**
 * Disconnect the SSE event stream.
 */
export function disconnectSSE() {
    sseAbortController?.abort();
    sseAbortController = null;
    sseConnected = false;
}
/**
 * Whether the SSE stream is currently connected.
 */
export function isSSEConnected() {
    return sseConnected;
}
/**
 * Wait for command ACK via SSE push.
 * Falls back to polling if SSE is not active.
 */
export async function waitForCommandAck(config, options) {
    const timeoutMs = options.timeoutMs ?? 15_000;
    dbg(`[sse-cmd] Waiting for ACK: commandId=${options.commandId}, timeout=${timeoutMs}ms`);
    // Ensure SSE is connected for real-time ACKs
    connectSSE(config);
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
        // Also poll as fallback (SSE may not be connected yet or may be reconnecting)
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
                // Polling failure is non-fatal; SSE or next poll may succeed
            }
        }, 500);
        options.signal?.addEventListener("abort", () => {
            cleanup();
            reject(new Error("The operation was aborted"));
        }, { once: true });
        function cleanup() {
            clearTimeout(timeout);
            unsubscribe();
            if (pollInterval)
                clearInterval(pollInterval);
        }
    });
}

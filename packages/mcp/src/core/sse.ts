import type { ZhiHandRuntimeConfig } from "./config.ts";
import type { QueuedCommandRecord, WaitForCommandAckResult } from "./command.ts";
import { getCommand } from "./command.ts";
import { log } from "./logger.ts";

export interface SSEEvent {
  id: string;
  topic: string;
  kind: string;
  credential_id: string;
  command?: QueuedCommandRecord;
  device_profile?: Record<string, unknown>;
  credential?: Record<string, unknown>;  // credential.added / credential.removed events
  sequence: number;
}

// Per-commandId callback registry for SSE-based ACK (global — ids are globally unique)
const ackCallbacks = new Map<string, (command: QueuedCommandRecord) => void>();

export function handleSSEEvent(event: SSEEvent): void {
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

export function subscribeToCommandAck(
  commandId: string,
  callback: (cmd: QueuedCommandRecord) => void,
): () => void {
  ackCallbacks.set(commandId, callback);
  return () => { ackCallbacks.delete(commandId); };
}

// ── UserEventStream — per-user SSE connection ──────────────

export interface UserEventStreamHandlers {
  onDeviceOnline: (credentialId: string) => void;
  onDeviceOffline: (credentialId: string) => void;
  onDeviceProfileUpdated: (credentialId: string, profile: Record<string, unknown>) => void;
  onCommandAcked: (event: SSEEvent) => void;
  onCredentialAdded: (credential: Record<string, unknown>) => void;
  onCredentialRemoved: (credentialId: string) => void;
  onConnected: () => void;
  onDisconnected: () => void;
}

export class UserEventStream {
  private abortController: AbortController | null = null;
  private _connected = false;

  constructor(
    private userId: string,
    private controllerToken: string,
    private endpoint: string,
    private handlers: UserEventStreamHandlers,
  ) {}

  get connected(): boolean {
    return this._connected;
  }

  start(): void {
    if (this.abortController) return;
    this.abortController = new AbortController();
    this.runLoop(this.abortController.signal);
  }

  stop(): void {
    this.abortController?.abort();
    this.abortController = null;
    this._connected = false;
  }

  private async runLoop(signal: AbortSignal): Promise<void> {
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
        if (!reader) throw new Error("No response body for SSE");

        const decoder = new TextDecoder();
        let buffer = "";
        let eventData = "";

        while (!signal.aborted) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";
          for (const line of lines) {
            if (line.startsWith("data: ")) {
              eventData += (eventData ? "\n" : "") + line.slice(6);
            } else if (line === "" && eventData) {
              try {
                const ev = JSON.parse(eventData) as SSEEvent;
                this.dispatchEvent(ev);
              } catch {
                // malformed, skip
              }
              eventData = "";
            }
          }
        }
      } catch (err) {
        if (signal.aborted) break;
        this._connected = false;
        this.handlers.onDisconnected();
        await new Promise((r) => setTimeout(r, backoffMs));
        backoffMs = Math.min(backoffMs * 2, BACKOFF_MAX);
      }
    }
    this._connected = false;
    this.handlers.onDisconnected();
  }

  private dispatchEvent(ev: SSEEvent): void {
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

// ── Fetch user credentials (for reconciliation on reconnect) ──

export interface CredentialResponse {
  credential_id: string;
  label?: string;
  platform?: string;
  online?: boolean;
  paired_at?: string;
  last_seen_at?: string;
  device_profile?: Record<string, unknown>;
}

export async function fetchUserCredentials(
  endpoint: string,
  userId: string,
  controllerToken: string,
  onlineFilter?: boolean,
): Promise<CredentialResponse[]> {
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
  const data = (await response.json()) as { items?: CredentialResponse[] };
  return data.items ?? [];
}

/**
 * Wait for command ACK via SSE push (which should already be connected by the
 * registry). Falls back to polling.
 */
export async function waitForCommandAck(
  config: ZhiHandRuntimeConfig,
  options: { commandId: string; timeoutMs?: number; signal?: AbortSignal },
): Promise<WaitForCommandAckResult> {
  const timeoutMs = options.timeoutMs ?? 15_000;
  log.debug(`[sse-cmd] Waiting for ACK: commandId=${options.commandId}, timeout=${timeoutMs}ms`);

  return new Promise<WaitForCommandAckResult>((resolve, reject) => {
    let resolved = false;
    let pollInterval: ReturnType<typeof setInterval> | undefined;

    const timeout = setTimeout(() => {
      cleanup();
      resolve({ acked: false });
    }, timeoutMs);

    const unsubscribe = subscribeToCommandAck(options.commandId, (ackedCommand) => {
      if (resolved) return;
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
      if (resolved) return;
      pollInterval = setInterval(async () => {
        if (resolved) return;
        try {
          const cmd = await getCommand(config, options.commandId);
          if (cmd.acked_at) {
            resolved = true;
            cleanup();
            resolve({ acked: true, command: cmd });
          }
        } catch {
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
      if (pollInterval) clearInterval(pollInterval);
    }
  });
}

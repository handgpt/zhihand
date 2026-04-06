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
import type { ZhiHandRuntimeConfig } from "./config.ts";
import type { QueuedCommandRecord, WaitForCommandAckResult } from "./command.ts";
import { getCommand } from "./command.ts";
import { log } from "./logger.ts";

// ── Shared reconnecting base ─────────────────────────────

const BACKOFF_INITIAL_MS = 1000;
const BACKOFF_MAX_MS = 30_000;
const WATCHDOG_TIMEOUT_MS = 35_000; // slightly > server ping interval (expect ~30s)

export interface ReconnectingWSOptions {
  url: string;
  headers?: Record<string, string>;
  onOpen?: () => void;
  onClose?: (code: number, reason: string) => void;
  onMessage?: (data: unknown) => void;
  onError?: (err: Error) => void;
}

export class ReconnectingWebSocket {
  private ws: WebSocket | null = null;
  private backoffMs = BACKOFF_INITIAL_MS;
  private aborted = false;
  private watchdogTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private hadOpen = false;
  private consecutiveFailures = 0;
  private static readonly MAX_CONSECUTIVE_FAILURES = 10;

  constructor(private opts: ReconnectingWSOptions) {}

  start(): void {
    this.aborted = false;
    this.connect();
  }

  stop(): void {
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

  send(data: string): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(data);
    }
  }

  get connected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  private connect(): void {
    if (this.aborted) return;

    try {
      this.ws = new WebSocket(this.opts.url, {
        headers: this.opts.headers,
      });
    } catch (err) {
      log.error(`[ws] Failed to create WebSocket: ${(err as Error).message}`);
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

    this.ws.on("message", (raw: Buffer) => {
      this.resetWatchdog();
      try {
        const data = JSON.parse(raw.toString());
        this.opts.onMessage?.(data);
      } catch {
        // malformed message — ignore
      }
    });

    this.ws.on("ping", () => {
      // Protocol-level ping from server — ws lib auto-sends pong.
      // Reset watchdog on any activity.
      this.resetWatchdog();
    });

    this.ws.on("close", (code: number, reason: Buffer) => {
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

    this.ws.on("error", (err: Error) => {
      this.opts.onError?.(err);
    });
  }

  private scheduleReconnect(): void {
    if (this.aborted) return;
    // Jitter: ±25% of current backoff
    const jitter = this.backoffMs * 0.25 * (Math.random() * 2 - 1);
    const delay = Math.round(this.backoffMs + jitter);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.backoffMs = Math.min(this.backoffMs * 2, BACKOFF_MAX_MS);
      this.connect();
    }, delay);
  }

  private resetWatchdog(): void {
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

  private clearWatchdog(): void {
    if (this.watchdogTimer) {
      clearTimeout(this.watchdogTimer);
      this.watchdogTimer = null;
    }
  }
}

// ── Command ACK infrastructure (migrated from sse.ts) ────

const ackCallbacks = new Map<string, (command: QueuedCommandRecord) => void>();

export interface WSEvent {
  id: string;
  topic: string;
  kind: string;
  credential_id: string;
  command?: QueuedCommandRecord;
  device_profile?: Record<string, unknown>;
  credential?: Record<string, unknown>;
  payload?: Record<string, unknown>;
  sequence: number;
}

export function handleWSEvent(event: WSEvent): void {
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

export function subscribeToCommandAck(
  commandId: string,
  callback: (cmd: QueuedCommandRecord) => void,
): () => void {
  ackCallbacks.set(commandId, callback);
  return () => { ackCallbacks.delete(commandId); };
}

// ── UserEventWebSocket — per-user WS (replaces UserEventStream) ──

export interface UserEventStreamHandlers {
  onDeviceOnline: (credentialId: string) => void;
  onDeviceOffline: (credentialId: string) => void;
  onDeviceProfileUpdated: (credentialId: string, profile: Record<string, unknown>) => void;
  onCommandAcked: (event: WSEvent) => void;
  onCredentialAdded: (credential: Record<string, unknown>) => void;
  onCredentialRemoved: (credentialId: string) => void;
  onConnected: () => void;
  onDisconnected: () => void;
}

export class UserEventWebSocket {
  private rws: ReconnectingWebSocket;
  private lastProcessedSeq = new Map<string, number>();

  constructor(
    userId: string,
    private controllerToken: string,
    endpoint: string,
    private handlers: UserEventStreamHandlers,
  ) {
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

  get connected(): boolean {
    return this.rws.connected;
  }

  start(): void {
    this.rws.start();
  }

  stop(): void {
    this.rws.stop();
  }

  private handleMessage(data: unknown): void {
    const msg = data as Record<string, unknown>;

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
      const ev = msg as unknown as WSEvent;
      this.dispatchEvent(ev);
    }
  }

  private dispatchEvent(ev: WSEvent): void {
    // Sequence dedup per credential
    if (ev.credential_id && ev.sequence != null) {
      const lastSeq = this.lastProcessedSeq.get(ev.credential_id) ?? -1;
      if (ev.sequence <= lastSeq) return;
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

// ── Fetch user credentials (HTTP REST — unchanged) ───────

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
 * Wait for command ACK via WS push (which should already be connected by the
 * registry). Falls back to polling.
 */
export async function waitForCommandAck(
  config: ZhiHandRuntimeConfig,
  options: { commandId: string; timeoutMs?: number; signal?: AbortSignal },
): Promise<WaitForCommandAckResult> {
  const timeoutMs = options.timeoutMs ?? 15_000;
  log.debug(`[ws-cmd] Waiting for ACK: commandId=${options.commandId}, timeout=${timeoutMs}ms`);

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

    // Delay polling startup by 2s so WS push ACK normally wins in the
    // registry-connected path. CLI (zhihand test) still resolves via polling
    // after the initial delay.
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

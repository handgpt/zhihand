import type { ZhiHandRuntimeConfig } from "../core/config.ts";
import { ReconnectingWebSocket } from "../core/ws.ts";
import { dbg } from "./logger.ts";

type ZhiHandConfig = ZhiHandRuntimeConfig;

export interface MobilePrompt {
  id: string;
  credential_id: string;
  edge_id: string;
  text: string;
  status: string;
  client_message_id?: string;
  created_at: string;
  attachments?: unknown[];
}

export type PromptHandler = (prompt: MobilePrompt) => void;

const POLL_INTERVAL = 2_000;

export class PromptListener {
  private config: ZhiHandConfig;
  private handler: PromptHandler;
  private log: (msg: string) => void;
  private processedIds = new Set<string>();
  private rws: ReconnectingWebSocket | null = null;
  private pollTimer: ReturnType<typeof setTimeout> | null = null;
  private wsConnected = false;
  private stopped = false;

  constructor(config: ZhiHandConfig, handler: PromptHandler, log: (msg: string) => void) {
    this.config = config;
    this.handler = handler;
    this.log = log;
  }

  start(): void {
    this.stopped = false;
    this.connectWS();
  }

  stop(): void {
    this.stopped = true;
    this.rws?.stop();
    this.rws = null;
    this.wsConnected = false;
    this.stopPolling();
  }

  private dispatchPrompt(prompt: MobilePrompt): void {
    if (this.processedIds.has(prompt.id)) {
      dbg(`[prompt] Skipping duplicate prompt: ${prompt.id}`);
      return;
    }
    this.processedIds.add(prompt.id);
    dbg(`[prompt] Dispatching prompt: id=${prompt.id}, status=${prompt.status}, text="${prompt.text.slice(0, 100)}${prompt.text.length > 100 ? "..." : ""}"`);
    // Prevent unbounded growth
    if (this.processedIds.size > 500) {
      const arr = [...this.processedIds];
      this.processedIds = new Set(arr.slice(-250));
    }
    this.handler(prompt);
  }

  private connectWS(): void {
    if (this.stopped) return;

    const wsUrl = `${this.config.controlPlaneEndpoint.replace(/^http/, "ws")}/v1/credentials/${encodeURIComponent(this.config.credentialId)}/ws?topic=prompts`;

    dbg(`[ws] Connecting to ${wsUrl}`);

    this.rws = new ReconnectingWebSocket({
      url: wsUrl,
      headers: {
        "Authorization": `Bearer ${this.config.controllerToken}`,
      },
      onOpen: () => {
        this.wsConnected = true;
        this.stopPolling();
        this.log("[ws] Connected to prompt stream.");
      },
      onClose: (_code, _reason) => {
        if (this.wsConnected) {
          this.wsConnected = false;
          this.log("[ws] Disconnected. Falling back to polling.");
          this.startPolling();
        }
      },
      onMessage: (data) => {
        this.handleWSMessage(data);
      },
      onError: (err) => {
        dbg(`[ws] Error: ${err.message}`);
      },
    });
    this.rws.start();
  }

  private handleWSMessage(data: unknown): void {
    const msg = data as Record<string, unknown>;

    // Application-level ping (if server sends these alongside protocol pings)
    if (msg.type === "ping") {
      this.rws?.send(JSON.stringify({ type: "pong" }));
      return;
    }

    // Event dispatch
    if (msg.type === "event" || msg.kind) {
      this.handleEvent(msg as Record<string, unknown>);
    }
  }

  private handleEvent(event: Record<string, unknown>): void {
    const kind = event.kind as string | undefined;
    dbg(`[ws] Event: kind=${kind}, prompt=${(event.prompt as MobilePrompt)?.id ?? "-"}, prompts=${(event.prompts as MobilePrompt[])?.length ?? 0}`);

    if (kind === "prompt.queued" && event.prompt) {
      this.dispatchPrompt(event.prompt as MobilePrompt);
    } else if (kind === "prompt.snapshot" && event.prompts) {
      for (const p of event.prompts as MobilePrompt[]) {
        if (p.status === "pending" || p.status === "processing") {
          this.dispatchPrompt(p);
        }
      }
    } else if (kind === "device_profile.updated") {
      this.log("[device] device_profile.updated event received on prompts stream (ignored; registry handles it)");
    }
  }

  private startPolling(): void {
    if (this.pollTimer || this.stopped) return;
    this.schedulePoll();
  }

  private schedulePoll(): void {
    if (this.pollTimer) return;
    this.pollTimer = setTimeout(async () => {
      this.pollTimer = null;
      await this.poll();
      if (!this.wsConnected && !this.stopped) {
        this.schedulePoll();
      }
    }, POLL_INTERVAL);
  }

  private stopPolling(): void {
    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }
  }

  private async poll(): Promise<void> {
    try {
      const url = `${this.config.controlPlaneEndpoint}/v1/credentials/${encodeURIComponent(this.config.credentialId)}/prompts?limit=5`;
      dbg(`[poll] GET ${url}`);
      const response = await fetch(url, {
        headers: { "Authorization": `Bearer ${this.config.controllerToken}` },
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) {
        dbg(`[poll] Response: ${response.status}`);
        return;
      }
      const data = (await response.json()) as { items?: MobilePrompt[] };
      dbg(`[poll] Got ${data.items?.length ?? 0} prompt(s)`);
      if (this.stopped) return; // Guard against late responses after stop()
      for (const prompt of data.items ?? []) {
        this.dispatchPrompt(prompt);
      }
    } catch (err) {
      dbg(`[poll] Error: ${(err as Error).message}`);
    }
  }
}

import { ReconnectingWebSocket } from "../core/ws.ts";
import { dbg } from "./logger.ts";

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

/** Edge-level prompt listener config. Uses pluginSecret instead of per-user controllerToken. */
export interface PromptListenerConfig {
  controlPlaneEndpoint: string;
  edgeId: string;
  pluginSecret: string;
}

export class PromptListener {
  private config: PromptListenerConfig;
  private handler: PromptHandler;
  private log: (msg: string) => void;
  private onFatalError?: (reason: string) => void;
  private processedIds = new Set<string>();
  private rws: ReconnectingWebSocket | null = null;
  private stopped = false;

  constructor(config: PromptListenerConfig, handler: PromptHandler, log: (msg: string) => void, onFatalError?: (reason: string) => void) {
    this.config = config;
    this.handler = handler;
    this.log = log;
    this.onFatalError = onFatalError;
  }

  start(): void {
    this.stopped = false;
    this.connectWS();
  }

  stop(): void {
    this.stopped = true;
    this.rws?.stop();
    this.rws = null;
  }

  private dispatchPrompt(prompt: MobilePrompt): void {
    if (this.processedIds.has(prompt.id)) {
      dbg(`[prompt] Skipping duplicate prompt: ${prompt.id}`);
      return;
    }
    this.processedIds.add(prompt.id);
    dbg(`[prompt] Dispatching prompt: id=${prompt.id}, cred=${prompt.credential_id}, status=${prompt.status}, text="${prompt.text.slice(0, 100)}${prompt.text.length > 100 ? "..." : ""}"`);
    // Prevent unbounded growth
    if (this.processedIds.size > 500) {
      const arr = [...this.processedIds];
      this.processedIds = new Set(arr.slice(-250));
    }
    this.handler(prompt);
  }

  private connectWS(): void {
    if (this.stopped) return;

    // Edge-level WS: single connection for all credentials under this edge
    const wsUrl = `${this.config.controlPlaneEndpoint.replace(/^http/, "ws")}/v1/plugins/${encodeURIComponent(this.config.edgeId)}/ws?topic=prompts`;

    dbg(`[ws] Connecting to ${wsUrl}`);

    this.rws = new ReconnectingWebSocket({
      url: wsUrl,
      headers: {},
      onOpen: () => {
        // Send auth frame with pluginSecret (server verifies before streaming)
        this.rws!.send(JSON.stringify({
          type: "auth",
          plugin_secret: this.config.pluginSecret,
        }));
      },
      onClose: (_code, _reason) => {
        dbg("[ws] Disconnected. ReconnectingWebSocket will retry.");
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

    if (msg.type === "auth_ok") {
      this.log("[ws] Connected to Edge prompt stream.");
      return;
    }
    if (msg.type === "auth_error") {
      const reason = `Plugin auth failed: ${msg.error}. Run 'zhihand pair' to re-register.`;
      this.log(`[ws] ${reason}`);
      this.rws?.stop();
      this.rws = null;
      this.onFatalError?.(reason);
      return;
    }
    if (msg.type === "ping") {
      this.rws?.send(JSON.stringify({ type: "pong" }));
      return;
    }
    if (msg.type === "event" || msg.kind) {
      this.handleEvent(msg as Record<string, unknown>);
    }
  }

  private handleEvent(event: Record<string, unknown>): void {
    const kind = event.kind as string | undefined;
    dbg(`[ws] Event: kind=${kind}, prompt=${(event.prompt as MobilePrompt)?.id ?? "-"}`);

    if (kind === "prompt.queued" && event.prompt) {
      this.dispatchPrompt(event.prompt as MobilePrompt);
    } else if (kind === "prompt.snapshot" && event.prompt) {
      // Edge WS sends individual snapshot events (one per pending prompt)
      const p = event.prompt as MobilePrompt;
      if (p.status === "pending" || p.status === "processing") {
        this.dispatchPrompt(p);
      }
    }
  }
}

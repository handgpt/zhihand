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

export class PromptListener {
  private config: ZhiHandConfig;
  private handler: PromptHandler;
  private log: (msg: string) => void;
  private processedIds = new Set<string>();
  private rws: ReconnectingWebSocket | null = null;
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
        // Send auth message as first frame (required by server).
        this.rws!.send(JSON.stringify({
          type: "auth",
          controller_token: this.config.controllerToken,
          topics: ["prompts"],
        }));
        // onConnected deferred until auth_ok is received (see handleWSMessage)
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

    // Auth responses
    if (msg.type === "auth_ok") {
      this.log("[ws] Connected to prompt stream.");
      return;
    }
    if (msg.type === "auth_error") {
      this.log(`[ws] Auth failed: ${msg.error}`);
      this.rws?.stop();
      this.rws = null;
      return;
    }

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
}

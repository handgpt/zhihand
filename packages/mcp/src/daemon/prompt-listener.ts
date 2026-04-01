import type { ZhiHandConfig } from "../core/config.ts";

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

const SSE_WATCHDOG_TIMEOUT = 45_000; // 45s no data → reconnect
const SSE_RECONNECT_DELAY = 3_000;
const POLL_INTERVAL = 2_000;

export class PromptListener {
  private config: ZhiHandConfig;
  private handler: PromptHandler;
  private log: (msg: string) => void;
  private processedIds = new Set<string>();
  private sseAbort: AbortController | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private sseConnected = false;
  private stopped = false;

  constructor(config: ZhiHandConfig, handler: PromptHandler, log: (msg: string) => void) {
    this.config = config;
    this.handler = handler;
    this.log = log;
  }

  start(): void {
    this.stopped = false;
    this.connectSSE();
  }

  stop(): void {
    this.stopped = true;
    this.sseAbort?.abort();
    this.sseAbort = null;
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  private dispatchPrompt(prompt: MobilePrompt): void {
    if (this.processedIds.has(prompt.id)) return;
    this.processedIds.add(prompt.id);
    // Prevent unbounded growth
    if (this.processedIds.size > 500) {
      const arr = [...this.processedIds];
      this.processedIds = new Set(arr.slice(-250));
    }
    this.handler(prompt);
  }

  private async connectSSE(): Promise<void> {
    while (!this.stopped) {
      try {
        this.sseAbort = new AbortController();
        const url = `${this.config.controlPlaneEndpoint}/v1/credentials/${encodeURIComponent(this.config.credentialId)}/events/stream?topic=prompts`;

        const response = await fetch(url, {
          headers: {
            "Accept": "text/event-stream",
            "x-zhihand-controller-token": this.config.controllerToken,
          },
          signal: this.sseAbort.signal,
        });

        if (!response.ok) {
          throw new Error(`SSE connect failed: ${response.status}`);
        }

        this.sseConnected = true;
        this.stopPolling();
        this.log("[sse] Connected to prompt stream.");

        const reader = response.body?.getReader();
        if (!reader) throw new Error("No response body for SSE");

        const decoder = new TextDecoder();
        let buffer = "";
        let watchdog = this.resetWatchdog();

        while (!this.stopped) {
          const { done, value } = await reader.read();
          if (done) break;

          // Reset watchdog on any data (including keepalive comments)
          clearTimeout(watchdog);
          watchdog = this.resetWatchdog();

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";

          let eventData = "";
          for (const line of lines) {
            if (line.startsWith("data: ")) {
              eventData += (eventData ? "\n" : "") + line.slice(6);
            } else if (line === "" && eventData) {
              try {
                const event = JSON.parse(eventData);
                this.handleSSEEvent(event);
              } catch {
                // Malformed event
              }
              eventData = "";
            }
          }
        }

        clearTimeout(watchdog);
      } catch (err) {
        if (this.stopped) break;
        this.sseConnected = false;
        this.log(`[sse] Disconnected. Falling back to polling. (${(err as Error).message})`);
        this.startPolling();
        await new Promise((r) => setTimeout(r, SSE_RECONNECT_DELAY));
      }
    }
  }

  private resetWatchdog(): ReturnType<typeof setTimeout> {
    return setTimeout(() => {
      this.log("[sse] Watchdog timeout (45s no data). Reconnecting...");
      this.sseAbort?.abort();
    }, SSE_WATCHDOG_TIMEOUT);
  }

  private handleSSEEvent(event: { kind?: string; prompt?: MobilePrompt; prompts?: MobilePrompt[] }): void {
    if (event.kind === "prompt.queued" && event.prompt) {
      this.dispatchPrompt(event.prompt);
    } else if (event.kind === "prompt.snapshot" && event.prompts) {
      for (const p of event.prompts) {
        if (p.status === "pending" || p.status === "processing") {
          this.dispatchPrompt(p);
        }
      }
    }
  }

  private startPolling(): void {
    if (this.pollTimer) return;
    this.pollTimer = setInterval(() => this.poll(), POLL_INTERVAL);
  }

  private stopPolling(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  private async poll(): Promise<void> {
    try {
      const url = `${this.config.controlPlaneEndpoint}/v1/credentials/${encodeURIComponent(this.config.credentialId)}/prompts?limit=5`;
      const response = await fetch(url, {
        headers: { "x-zhihand-controller-token": this.config.controllerToken },
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) return;
      const data = (await response.json()) as { items?: MobilePrompt[] };
      for (const prompt of data.items ?? []) {
        this.dispatchPrompt(prompt);
      }
    } catch {
      // Polling failure is non-fatal
    }
  }
}

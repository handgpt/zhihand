import { ReconnectingWebSocket } from "../core/ws.js";
import { dbg } from "./logger.js";
export class PromptListener {
    config;
    handler;
    log;
    onFatalError;
    processedIds = new Set();
    rws = null;
    stopped = false;
    constructor(config, handler, log, onFatalError) {
        this.config = config;
        this.handler = handler;
        this.log = log;
        this.onFatalError = onFatalError;
    }
    start() {
        this.stopped = false;
        this.connectWS();
    }
    stop() {
        this.stopped = true;
        this.rws?.stop();
        this.rws = null;
    }
    dispatchPrompt(prompt) {
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
    connectWS() {
        if (this.stopped)
            return;
        // Edge-level WS: single connection for all credentials under this edge
        const wsUrl = `${this.config.controlPlaneEndpoint.replace(/^http/, "ws")}/v1/plugins/${encodeURIComponent(this.config.edgeId)}/ws?topic=prompts`;
        dbg(`[ws] Connecting to ${wsUrl}`);
        this.rws = new ReconnectingWebSocket({
            url: wsUrl,
            headers: {},
            onOpen: () => {
                // Send auth frame with pluginSecret (server verifies before streaming)
                this.rws.send(JSON.stringify({
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
    handleWSMessage(data) {
        const msg = data;
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
            this.handleEvent(msg);
        }
    }
    handleEvent(event) {
        const kind = event.kind;
        dbg(`[ws] Event: kind=${kind}, prompt=${event.prompt?.id ?? "-"}`);
        if (kind === "prompt.queued" && event.prompt) {
            this.dispatchPrompt(event.prompt);
        }
        else if (kind === "prompt.snapshot" && event.prompt) {
            // Edge WS sends individual snapshot events (one per pending prompt)
            const p = event.prompt;
            if (p.status === "pending" || p.status === "processing") {
                this.dispatchPrompt(p);
            }
        }
    }
}

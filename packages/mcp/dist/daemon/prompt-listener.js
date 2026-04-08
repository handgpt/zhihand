import { ReconnectingWebSocket } from "../core/ws.js";
import { dbg } from "./logger.js";
export class PromptListener {
    config;
    handler;
    log;
    processedIds = new Set();
    rws = null;
    stopped = false;
    constructor(config, handler, log) {
        this.config = config;
        this.handler = handler;
        this.log = log;
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
        dbg(`[prompt] Dispatching prompt: id=${prompt.id}, status=${prompt.status}, text="${prompt.text.slice(0, 100)}${prompt.text.length > 100 ? "..." : ""}"`);
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
        const wsUrl = `${this.config.controlPlaneEndpoint.replace(/^http/, "ws")}/v1/credentials/${encodeURIComponent(this.config.credentialId)}/ws?topic=prompts`;
        dbg(`[ws] Connecting to ${wsUrl}`);
        this.rws = new ReconnectingWebSocket({
            url: wsUrl,
            headers: {
                "Authorization": `Bearer ${this.config.controllerToken}`,
            },
            onOpen: () => {
                // Send auth message as first frame (required by server).
                this.rws.send(JSON.stringify({
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
    handleWSMessage(data) {
        const msg = data;
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
            this.handleEvent(msg);
        }
    }
    handleEvent(event) {
        const kind = event.kind;
        dbg(`[ws] Event: kind=${kind}, prompt=${event.prompt?.id ?? "-"}, prompts=${event.prompts?.length ?? 0}`);
        if (kind === "prompt.queued" && event.prompt) {
            this.dispatchPrompt(event.prompt);
        }
        else if (kind === "prompt.snapshot" && event.prompts) {
            for (const p of event.prompts) {
                if (p.status === "pending" || p.status === "processing") {
                    this.dispatchPrompt(p);
                }
            }
        }
        else if (kind === "device_profile.updated") {
            this.log("[device] device_profile.updated event received on prompts stream (ignored; registry handles it)");
        }
    }
}

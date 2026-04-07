import { ReconnectingWebSocket } from "../core/ws.js";
import { dbg } from "./logger.js";
const POLL_INTERVAL = 2_000;
export class PromptListener {
    config;
    handler;
    log;
    processedIds = new Set();
    rws = null;
    pollTimer = null;
    wsConnected = false;
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
        this.wsConnected = false;
        this.stopPolling();
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
    handleWSMessage(data) {
        const msg = data;
        // Auth responses
        if (msg.type === "auth_ok") {
            this.wsConnected = true;
            this.stopPolling();
            this.log("[ws] Connected to prompt stream.");
            return;
        }
        if (msg.type === "auth_error") {
            this.log(`[ws] Auth failed: ${msg.error}`);
            this.rws?.stop();
            this.rws = null;
            this.wsConnected = false;
            this.startPolling();
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
    startPolling() {
        if (this.pollTimer || this.stopped)
            return;
        this.schedulePoll();
    }
    schedulePoll() {
        if (this.pollTimer)
            return;
        this.pollTimer = setTimeout(async () => {
            this.pollTimer = null;
            await this.poll();
            if (!this.wsConnected && !this.stopped) {
                this.schedulePoll();
            }
        }, POLL_INTERVAL);
    }
    stopPolling() {
        if (this.pollTimer) {
            clearTimeout(this.pollTimer);
            this.pollTimer = null;
        }
    }
    async poll() {
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
            const data = (await response.json());
            dbg(`[poll] Got ${data.items?.length ?? 0} prompt(s)`);
            if (this.stopped)
                return; // Guard against late responses after stop()
            for (const prompt of data.items ?? []) {
                this.dispatchPrompt(prompt);
            }
        }
        catch (err) {
            dbg(`[poll] Error: ${err.message}`);
        }
    }
}

import { createControlCommand, enqueueCommand, formatAckSummary } from "../core/command.js";
import { fetchScreenshotBinary } from "../core/screenshot.js";
import { waitForCommandAck } from "../core/sse.js";
function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
}
export async function executeControl(config, params) {
    // wait: Plugin-local implementation, no server round-trip
    if (params.action === "wait") {
        await sleep(params.durationMs ?? 1000);
        const screenshot = await fetchScreenshotBinary(config);
        return {
            content: [
                { type: "text", text: `Waited ${params.durationMs ?? 1000}ms` },
                { type: "image", data: screenshot.toString("base64"), mimeType: "image/jpeg" },
            ],
        };
    }
    // screenshot: send receive_screenshot, App captures immediately (no 2s delay)
    if (params.action === "screenshot") {
        return await executeScreenshot(config);
    }
    // HID operations: enqueue → ACK → GET screenshot
    const command = createControlCommand(params);
    const queued = await enqueueCommand(config, command);
    const ack = await waitForCommandAck(config, { commandId: queued.id, timeoutMs: 15_000 });
    const content = [
        { type: "text", text: formatAckSummary(params.action, ack) },
    ];
    if (ack.acked) {
        try {
            const screenshot = await fetchScreenshotBinary(config);
            content.push({ type: "image", data: screenshot.toString("base64"), mimeType: "image/jpeg" });
        }
        catch {
            // Screenshot is best-effort after ACK
        }
    }
    return { content };
}
export async function executeScreenshot(config) {
    const command = createControlCommand({ action: "screenshot" });
    const queued = await enqueueCommand(config, command);
    const ack = await waitForCommandAck(config, { commandId: queued.id, timeoutMs: 5_000 });
    const screenshot = await fetchScreenshotBinary(config);
    return {
        content: [
            { type: "text", text: `Screenshot captured (acked: ${ack.acked})` },
            { type: "image", data: screenshot.toString("base64"), mimeType: "image/jpeg" },
        ],
    };
}

import { createControlCommand, enqueueCommand, formatAckSummary } from "../core/command.js";
import { fetchScreenshot } from "../core/screenshot.js";
import { waitForCommandAck } from "../core/sse.js";
import { getCapabilities, isDeviceProfileLoaded } from "../core/device.js";
function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
}
/**
 * Build a short human-readable warning for the LLM if the underlying
 * capability isn't ready, or if the last screenshot is stale. Returns
 * empty string when everything is nominal.
 */
function buildReadinessWarning(requiredCapability, screenshot) {
    if (!isDeviceProfileLoaded())
        return "";
    const caps = getCapabilities();
    const warnings = [];
    if (requiredCapability === "hid" && !caps.hid.ready) {
        warnings.push(`⚠️ HID not ready: ${caps.hid.reason}`);
    }
    if (requiredCapability === "screen" && !caps.screen_sharing.ready) {
        warnings.push(`⚠️ Screen sharing not active: ${caps.screen_sharing.reason}`);
    }
    if (screenshot && screenshot.stale) {
        warnings.push(`⚠️ Stale screenshot: age=${(screenshot.ageMs / 1000).toFixed(1)}s (phone may not be actively sharing the screen).`);
    }
    if (caps.profile.stale) {
        warnings.push(`⚠️ Stale device profile: ${(caps.profile.age_ms / 1000).toFixed(1)}s old — readiness flags may be out of date.`);
    }
    return warnings.join("\n");
}
export async function executeControl(config, params) {
    // wait: Plugin-local implementation, no server round-trip
    if (params.action === "wait") {
        await sleep(params.durationMs ?? 1000);
        const shot = await fetchScreenshot(config);
        const warning = buildReadinessWarning("screen", shot);
        const content = [];
        if (warning)
            content.push({ type: "text", text: warning });
        content.push({ type: "text", text: `Waited ${params.durationMs ?? 1000}ms` });
        content.push({ type: "image", data: shot.buffer.toString("base64"), mimeType: "image/jpeg" });
        return { content };
    }
    // screenshot: send receive_screenshot, App captures immediately (no 2s delay)
    if (params.action === "screenshot") {
        return await executeScreenshot(config);
    }
    // HID operations: enqueue → ACK → GET screenshot
    const command = createControlCommand(params);
    const queued = await enqueueCommand(config, command);
    const ack = await waitForCommandAck(config, { commandId: queued.id, timeoutMs: 15_000 });
    const content = [];
    let shot = null;
    if (ack.acked) {
        try {
            shot = await fetchScreenshot(config);
        }
        catch {
            // Screenshot is best-effort after ACK
        }
    }
    const warning = buildReadinessWarning("hid", shot);
    if (warning)
        content.push({ type: "text", text: warning });
    content.push({ type: "text", text: formatAckSummary(params.action, ack) });
    if (shot) {
        content.push({ type: "image", data: shot.buffer.toString("base64"), mimeType: "image/jpeg" });
    }
    return { content };
}
export async function executeScreenshot(config) {
    const command = createControlCommand({ action: "screenshot" });
    const queued = await enqueueCommand(config, command);
    const ack = await waitForCommandAck(config, { commandId: queued.id, timeoutMs: 5_000 });
    const shot = await fetchScreenshot(config);
    const warning = buildReadinessWarning("screen", shot);
    const content = [];
    if (warning)
        content.push({ type: "text", text: warning });
    content.push({
        type: "text",
        text: `Screenshot captured (acked: ${ack.acked}, age: ${shot.ageMs >= 0 ? `${shot.ageMs}ms` : "unknown"}, size: ${shot.width}x${shot.height}, seq: ${shot.sequence})`,
    });
    content.push({ type: "image", data: shot.buffer.toString("base64"), mimeType: "image/jpeg" });
    return { content };
}

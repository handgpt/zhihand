import { createControlCommand, enqueueCommand, formatAckSummary } from "../core/command.js";
import { fetchScreenshot } from "../core/screenshot.js";
import { waitForCommandAck } from "../core/ws.js";
function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
}
/**
 * Build a short human-readable warning for the LLM if the underlying
 * capability isn't ready, or if the last screenshot is stale.
 */
export function buildReadinessWarning(requiredCapability, capabilities, screenshot) {
    if (!capabilities)
        return "";
    const warnings = [];
    if (requiredCapability === "hid" && !capabilities.hid.ready) {
        warnings.push(`⚠️ HID not ready: ${capabilities.hid.reason}`);
    }
    if (requiredCapability === "screen" && !capabilities.screen_sharing.ready) {
        warnings.push(`⚠️ Screen sharing not active: ${capabilities.screen_sharing.reason}`);
    }
    if (screenshot && screenshot.stale) {
        warnings.push(`⚠️ Stale screenshot: age=${(screenshot.ageMs / 1000).toFixed(1)}s (phone may not be actively sharing the screen).`);
    }
    if (capabilities.profile.stale) {
        warnings.push(`⚠️ Stale device profile: ${(capabilities.profile.age_ms / 1000).toFixed(1)}s old — readiness flags may be out of date.`);
    }
    return warnings.join("\n");
}
export async function executeControl(config, params, platform, capabilities) {
    if (params.action === "wait") {
        await sleep(params.durationMs ?? 1000);
        const shot = await fetchScreenshot(config);
        const warning = buildReadinessWarning("screen", capabilities, shot);
        const content = [];
        if (warning)
            content.push({ type: "text", text: warning });
        content.push({ type: "text", text: `Waited ${params.durationMs ?? 1000}ms` });
        content.push({ type: "image", data: shot.buffer.toString("base64"), mimeType: "image/jpeg" });
        return { content };
    }
    if (params.action === "screenshot") {
        return await executeScreenshot(config, capabilities);
    }
    const command = createControlCommand(params, platform);
    const queued = await enqueueCommand(config, command);
    const ack = await waitForCommandAck(config, { commandId: queued.id, timeoutMs: 15_000 });
    const content = [];
    let shot = null;
    if (ack.acked) {
        try {
            shot = await fetchScreenshot(config);
        }
        catch {
            // best-effort
        }
    }
    const warning = buildReadinessWarning("hid", capabilities, shot);
    if (warning)
        content.push({ type: "text", text: warning });
    content.push({ type: "text", text: formatAckSummary(params.action, ack) });
    if (shot) {
        content.push({ type: "image", data: shot.buffer.toString("base64"), mimeType: "image/jpeg" });
    }
    return { content };
}
export async function executeScreenshot(config, capabilities) {
    const command = createControlCommand({ action: "screenshot" });
    const queued = await enqueueCommand(config, command);
    const ack = await waitForCommandAck(config, { commandId: queued.id, timeoutMs: 5_000 });
    const shot = await fetchScreenshot(config);
    const warning = buildReadinessWarning("screen", capabilities, shot);
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

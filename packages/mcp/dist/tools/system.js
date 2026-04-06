import { createSystemCommand, enqueueCommand, formatAckSummary } from "../core/command.js";
import { waitForCommandAck } from "../core/ws.js";
const IOS_ONLY = new Set(["siri", "control_center"]);
const ANDROID_ONLY = new Set(["open_browser", "shortcut_help"]);
export async function executeSystem(config, params, platform) {
    // Platform guard
    if (platform !== "ios" && IOS_ONLY.has(params.action)) {
        return {
            content: [{ type: "text", text: `Action ${params.action} is not supported on platform ${platform}` }],
            isError: true,
        };
    }
    if (platform !== "android" && ANDROID_ONLY.has(params.action)) {
        return {
            content: [{ type: "text", text: `Action ${params.action} is not supported on platform ${platform}` }],
            isError: true,
        };
    }
    const command = createSystemCommand(params, platform);
    const queued = await enqueueCommand(config, command);
    const ack = await waitForCommandAck(config, { commandId: queued.id, timeoutMs: 15_000 });
    const summary = formatAckSummary(params.action, ack);
    return { content: [{ type: "text", text: summary }] };
}

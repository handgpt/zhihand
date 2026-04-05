import { createSystemCommand, enqueueCommand, formatAckSummary } from "../core/command.js";
import { waitForCommandAck } from "../core/sse.js";
export async function executeSystem(config, params) {
    const command = createSystemCommand(params);
    const queued = await enqueueCommand(config, command);
    const ack = await waitForCommandAck(config, { commandId: queued.id, timeoutMs: 15_000 });
    const summary = formatAckSummary(params.action, ack);
    return {
        content: [{ type: "text", text: summary }],
    };
}

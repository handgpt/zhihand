/**
 * zhihand_system tool handler — system navigation + media controls.
 *
 * Separated from zhihand_control to keep UI-control schema focused and
 * reduce LLM parameter hallucination (Gemini design review recommendation).
 */
import type { ZhiHandConfig } from "../core/config.ts";
import { createSystemCommand, enqueueCommand, formatAckSummary } from "../core/command.ts";
import type { SystemParams } from "../core/command.ts";
import { waitForCommandAck } from "../core/sse.ts";

type TextContent = { type: "text"; text: string };
type ToolResult = { content: TextContent[] };

export async function executeSystem(
  config: ZhiHandConfig,
  params: SystemParams,
): Promise<ToolResult> {
  const command = createSystemCommand(params);
  const queued = await enqueueCommand(config, command);
  const ack = await waitForCommandAck(config, { commandId: queued.id, timeoutMs: 15_000 });

  const summary = formatAckSummary(params.action, ack);

  return {
    content: [{ type: "text" as const, text: summary }],
  };
}

/**
 * zhihand_system tool handler — system navigation + media controls.
 */
import type { ZhiHandRuntimeConfig } from "../core/config.ts";
import { createSystemCommand, enqueueCommand, formatAckSummary } from "../core/command.ts";
import type { SystemParams } from "../core/command.ts";
import { waitForCommandAck } from "../core/ws.ts";

type TextContent = { type: "text"; text: string };
type ToolResult = { content: TextContent[]; isError?: boolean };

const IOS_ONLY = new Set(["siri", "control_center"]);
const ANDROID_ONLY = new Set(["open_browser", "shortcut_help"]);

export async function executeSystem(
  config: ZhiHandRuntimeConfig,
  params: SystemParams,
  platform: string,
): Promise<ToolResult> {
  // Platform guard
  if (platform !== "ios" && IOS_ONLY.has(params.action)) {
    return {
      content: [{ type: "text" as const, text: `Action ${params.action} is not supported on platform ${platform}` }],
      isError: true,
    };
  }
  if (platform !== "android" && ANDROID_ONLY.has(params.action)) {
    return {
      content: [{ type: "text" as const, text: `Action ${params.action} is not supported on platform ${platform}` }],
      isError: true,
    };
  }

  const command = createSystemCommand(params, platform);
  const queued = await enqueueCommand(config, command);
  const ack = await waitForCommandAck(config, { commandId: queued.id, timeoutMs: 15_000 });
  const summary = formatAckSummary(params.action, ack);
  return { content: [{ type: "text" as const, text: summary }] };
}

import type { ZhiHandConfig } from "../core/config.ts";
import { createControlCommand, enqueueCommand, formatAckSummary } from "../core/command.ts";
import type { ControlParams } from "../core/command.ts";
import { fetchScreenshotBinary } from "../core/screenshot.ts";
import { waitForCommandAck } from "../core/sse.ts";

type TextContent = { type: "text"; text: string };
type ImageContent = { type: "image"; data: string; mimeType: "image/jpeg" };
type ToolContent = TextContent | ImageContent;
type ToolResult = { content: ToolContent[] };

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export async function executeControl(
  config: ZhiHandConfig,
  params: ControlParams
): Promise<ToolResult> {
  // wait: Plugin-local implementation, no server round-trip
  if (params.action === "wait") {
    await sleep(params.durationMs ?? 1000);
    const screenshot = await fetchScreenshotBinary(config);
    return {
      content: [
        { type: "text" as const, text: `Waited ${params.durationMs ?? 1000}ms` },
        { type: "image" as const, data: screenshot.toString("base64"), mimeType: "image/jpeg" as const },
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

  const content: ToolContent[] = [
    { type: "text" as const, text: formatAckSummary(params.action, ack) },
  ];

  if (ack.acked) {
    try {
      const screenshot = await fetchScreenshotBinary(config);
      content.push({ type: "image" as const, data: screenshot.toString("base64"), mimeType: "image/jpeg" as const });
    } catch {
      // Screenshot is best-effort after ACK
    }
  }

  return { content };
}

export async function executeScreenshot(
  config: ZhiHandConfig
): Promise<ToolResult> {
  const command = createControlCommand({ action: "screenshot" });
  const queued = await enqueueCommand(config, command);
  const ack = await waitForCommandAck(config, { commandId: queued.id, timeoutMs: 5_000 });
  const screenshot = await fetchScreenshotBinary(config);
  return {
    content: [
      { type: "text" as const, text: `Screenshot captured (acked: ${ack.acked})` },
      { type: "image" as const, data: screenshot.toString("base64"), mimeType: "image/jpeg" as const },
    ],
  };
}

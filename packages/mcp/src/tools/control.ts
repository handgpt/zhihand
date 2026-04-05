import type { ZhiHandRuntimeConfig } from "../core/config.ts";
import { createControlCommand, enqueueCommand, formatAckSummary } from "../core/command.ts";
import type { ControlParams } from "../core/command.ts";
import { fetchScreenshot } from "../core/screenshot.ts";
import type { ScreenshotResult } from "../core/screenshot.ts";
import { waitForCommandAck } from "../core/sse.ts";
import type { Capabilities } from "../core/device.ts";

type TextContent = { type: "text"; text: string };
type ImageContent = { type: "image"; data: string; mimeType: "image/jpeg" };
type ToolContent = TextContent | ImageContent;
type ToolResult = { content: ToolContent[] };

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Build a short human-readable warning for the LLM if the underlying
 * capability isn't ready, or if the last screenshot is stale.
 */
export function buildReadinessWarning(
  requiredCapability: "hid" | "screen" | "none",
  capabilities: Capabilities | null,
  screenshot: ScreenshotResult | null,
): string {
  if (!capabilities) return "";
  const warnings: string[] = [];

  if (requiredCapability === "hid" && !capabilities.hid.ready) {
    warnings.push(`⚠️ HID not ready: ${capabilities.hid.reason}`);
  }
  if (requiredCapability === "screen" && !capabilities.screen_sharing.ready) {
    warnings.push(`⚠️ Screen sharing not active: ${capabilities.screen_sharing.reason}`);
  }
  if (screenshot && screenshot.stale) {
    warnings.push(
      `⚠️ Stale screenshot: age=${(screenshot.ageMs / 1000).toFixed(1)}s (phone may not be actively sharing the screen).`,
    );
  }
  if (capabilities.profile.stale) {
    warnings.push(
      `⚠️ Stale device profile: ${(capabilities.profile.age_ms / 1000).toFixed(1)}s old — readiness flags may be out of date.`,
    );
  }
  return warnings.join("\n");
}

export async function executeControl(
  config: ZhiHandRuntimeConfig,
  params: ControlParams,
  platform: string,
  capabilities: Capabilities | null,
): Promise<ToolResult> {
  if (params.action === "wait") {
    await sleep(params.durationMs ?? 1000);
    const shot = await fetchScreenshot(config);
    const warning = buildReadinessWarning("screen", capabilities, shot);
    const content: ToolContent[] = [];
    if (warning) content.push({ type: "text" as const, text: warning });
    content.push({ type: "text" as const, text: `Waited ${params.durationMs ?? 1000}ms` });
    content.push({ type: "image" as const, data: shot.buffer.toString("base64"), mimeType: "image/jpeg" as const });
    return { content };
  }

  if (params.action === "screenshot") {
    return await executeScreenshot(config, capabilities);
  }

  const command = createControlCommand(params, platform);
  const queued = await enqueueCommand(config, command);
  const ack = await waitForCommandAck(config, { commandId: queued.id, timeoutMs: 15_000 });

  const content: ToolContent[] = [];
  let shot: ScreenshotResult | null = null;
  if (ack.acked) {
    try {
      shot = await fetchScreenshot(config);
    } catch {
      // best-effort
    }
  }
  const warning = buildReadinessWarning("hid", capabilities, shot);
  if (warning) content.push({ type: "text" as const, text: warning });
  content.push({ type: "text" as const, text: formatAckSummary(params.action, ack) });
  if (shot) {
    content.push({ type: "image" as const, data: shot.buffer.toString("base64"), mimeType: "image/jpeg" as const });
  }

  return { content };
}

export async function executeScreenshot(
  config: ZhiHandRuntimeConfig,
  capabilities: Capabilities | null,
): Promise<ToolResult> {
  const command = createControlCommand({ action: "screenshot" });
  const queued = await enqueueCommand(config, command);
  const ack = await waitForCommandAck(config, { commandId: queued.id, timeoutMs: 5_000 });
  const shot = await fetchScreenshot(config);
  const warning = buildReadinessWarning("screen", capabilities, shot);
  const content: ToolContent[] = [];
  if (warning) content.push({ type: "text" as const, text: warning });
  content.push({
    type: "text" as const,
    text: `Screenshot captured (acked: ${ack.acked}, age: ${shot.ageMs >= 0 ? `${shot.ageMs}ms` : "unknown"}, size: ${shot.width}x${shot.height}, seq: ${shot.sequence})`,
  });
  content.push({ type: "image" as const, data: shot.buffer.toString("base64"), mimeType: "image/jpeg" as const });
  return { content };
}

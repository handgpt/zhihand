import type { ZhiHandConfig } from "./config.ts";
import { getStaticContext, isDeviceProfileLoaded } from "./device.ts";
import { dbg } from "../daemon/logger.ts";

export type ScrollDirection = "up" | "down" | "left" | "right";
export interface ControlParams {
  action: string;
  xRatio?: number;
  yRatio?: number;
  text?: string;
  direction?: ScrollDirection;
  amount?: number;
  keys?: string;
  durationMs?: number;
  startXRatio?: number;
  startYRatio?: number;
  endXRatio?: number;
  endYRatio?: number;
  appPackage?: string;
  bundleId?: string;
  urlScheme?: string;
}

export interface QueuedControlCommand {
  type: string;
  payload?: Record<string, unknown>;
  messageId?: number;
}

export interface QueuedCommandRecord {
  id: string;
  credential_id: string;
  status: string;
  command: QueuedControlCommand;
  created_at: string;
  acked_at?: string;
  ack_status?: string;
  ack_result?: Record<string, unknown>;
}

export interface WaitForCommandAckResult {
  acked: boolean;
  command?: QueuedCommandRecord;
}

let messageCounter = 0;

function nextMessageId(): number {
  messageCounter = (messageCounter + 1) % 1000;
  return (Date.now() * 1000) + messageCounter;
}

export function createControlCommand(params: ControlParams): QueuedControlCommand {
  switch (params.action) {
    case "click":
      return { type: "receive_click", payload: { x: params.xRatio, y: params.yRatio } };
    case "doubleclick":
      return { type: "receive_doubleclick", payload: { x: params.xRatio, y: params.yRatio } };
    case "longclick":
      return { type: "receive_longclick", payload: { x: params.xRatio, y: params.yRatio, time: params.durationMs ?? 800 } };
    case "rightclick":
      return { type: "receive_rightclick", payload: { x: params.xRatio, y: params.yRatio } };
    case "middleclick":
      return { type: "receive_middleclick", payload: { x: params.xRatio, y: params.yRatio } };
    case "type":
      return { type: "receive_input", payload: { input: params.text, mode: "auto", submit: false } };
    case "swipe":
      return {
        type: "receive_slide",
        payload: {
          x1: params.startXRatio,
          y1: params.startYRatio,
          x2: params.endXRatio,
          y2: params.endYRatio,
          time: params.durationMs ?? 300,
        },
      };
    case "scroll":
      return {
        type: "receive_scroll",
        payload: {
          x: params.xRatio,
          y: params.yRatio,
          direction: params.direction,
          amount: params.amount ?? 3,
        },
      };
    case "keycombo":
      return { type: "receive_key_combo", payload: { keys: params.keys } };
    case "back":
      return { type: "receive_back", payload: {} };
    case "home":
      return { type: "receive_home", payload: {} };
    case "enter":
      return { type: "receive_enter", payload: {} };
    case "clipboard":
      // App only supports set — payload: { clipboard: "text" }
      // No get support on device side; clipboardAction is ignored
      return {
        type: "receive_clipboard",
        payload: { clipboard: params.text ?? "" },
      };
    case "open_app": {
      const appPayload: Record<string, unknown> = {};
      const platform = isDeviceProfileLoaded() ? getStaticContext().platform : "unknown";
      // Only send platform-appropriate fields — Android strict JSON rejects unknown keys
      if (platform === "android") {
        // Android: only app_package
        if (params.appPackage) appPayload.app_package = params.appPackage;
      } else if (platform === "ios") {
        // iOS: bundleId or urlScheme
        if (params.bundleId) appPayload.bundle_id = params.bundleId;
        if (params.urlScheme) appPayload.url_scheme = params.urlScheme;
      } else {
        // Unknown platform: send only what's provided, prefer appPackage
        if (params.appPackage) appPayload.app_package = params.appPackage;
        else if (params.bundleId) appPayload.bundle_id = params.bundleId;
        else if (params.urlScheme) appPayload.url_scheme = params.urlScheme;
      }
      // Never send app_name — phone strict JSON parser rejects unknown keys
      if (!appPayload.app_package && !appPayload.bundle_id && !appPayload.url_scheme) {
        throw new Error("open_app requires at least one of: appPackage, bundleId, urlScheme");
      }
      dbg(`[cmd] open_app: platform=${platform}, payload=${JSON.stringify(appPayload)}`);
      return { type: "receive_app", payload: appPayload };
    }
    case "screenshot":
      return { type: "receive_screenshot", payload: {} };
    default:
      throw new Error(`Unsupported action: ${params.action}`);
  }
}

export async function enqueueCommand(
  config: ZhiHandConfig,
  command: QueuedControlCommand
): Promise<QueuedCommandRecord> {
  const url = `${config.controlPlaneEndpoint}/v1/credentials/${encodeURIComponent(config.credentialId)}/commands`;
  const body = { command: { ...command, message_id: command.messageId ?? nextMessageId() } };
  dbg(`[cmd] POST ${url} type=${command.type} payload=${JSON.stringify(command.payload ?? {})}`);
  const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-zhihand-controller-token": config.controllerToken,
      },
      body: JSON.stringify(body),
    }
  );
  if (!response.ok) {
    dbg(`[cmd] Enqueue failed: ${response.status} ${response.statusText}`);
    throw new Error(`Enqueue command failed: ${response.status}`);
  }
  const payload = (await response.json()) as { command: QueuedCommandRecord };
  dbg(`[cmd] Enqueued: id=${payload.command.id}, status=${payload.command.status}`);
  return payload.command;
}

export async function getCommand(
  config: ZhiHandConfig,
  commandId: string
): Promise<QueuedCommandRecord> {
  const url = `${config.controlPlaneEndpoint}/v1/credentials/${encodeURIComponent(config.credentialId)}/commands/${encodeURIComponent(commandId)}`;
  dbg(`[cmd] GET ${url}`);
  const response = await fetch(url, {
      headers: { "x-zhihand-controller-token": config.controllerToken },
    }
  );
  if (!response.ok) {
    dbg(`[cmd] Get failed: ${response.status}`);
    throw new Error(`Get command failed: ${response.status}`);
  }
  const payload = (await response.json()) as { command: QueuedCommandRecord };
  const cmd = payload.command;
  dbg(`[cmd] Got: id=${cmd.id}, status=${cmd.status}, acked=${!!cmd.acked_at}, ack_status=${cmd.ack_status ?? "-"}, ack_result=${JSON.stringify(cmd.ack_result ?? null)}`);
  return payload.command;
}

export function formatAckSummary(action: string, result: WaitForCommandAckResult): string {
  if (!result.acked) {
    return `Sent ${action}, waiting for ACK (timed out).`;
  }
  const ackStatus = result.command?.ack_status ?? "ok";
  return `Sent ${action}. ACK: ${ackStatus}`;
}

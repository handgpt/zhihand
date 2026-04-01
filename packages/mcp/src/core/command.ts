import type { ZhiHandConfig } from "./config.ts";

export type ScrollDirection = "up" | "down" | "left" | "right";
export type ClipboardAction = "get" | "set";

export interface ControlParams {
  action: string;
  xRatio?: number;
  yRatio?: number;
  text?: string;
  direction?: ScrollDirection;
  amount?: number;
  keys?: string;
  clipboardAction?: ClipboardAction;
  durationMs?: number;
  startXRatio?: number;
  startYRatio?: number;
  endXRatio?: number;
  endYRatio?: number;
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
    case "rightclick":
      return { type: "receive_rightclick", payload: { x: params.xRatio, y: params.yRatio } };
    case "middleclick":
      return { type: "receive_middleclick", payload: { x: params.xRatio, y: params.yRatio } };
    case "type":
      return { type: "receive_type", payload: { text: params.text } };
    case "swipe":
      return {
        type: "receive_swipe",
        payload: {
          startX: params.startXRatio,
          startY: params.startYRatio,
          endX: params.endXRatio,
          endY: params.endYRatio,
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
      return { type: "receive_keycombo", payload: { keys: params.keys } };
    case "clipboard":
      return {
        type: "receive_clipboard",
        payload: { action: params.clipboardAction, text: params.text },
      };
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
  const response = await fetch(
    `${config.controlPlaneEndpoint}/v1/credentials/${encodeURIComponent(config.credentialId)}/commands`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-zhihand-controller-token": config.controllerToken,
      },
      body: JSON.stringify({
        command: { ...command, message_id: command.messageId ?? nextMessageId() },
      }),
    }
  );
  if (!response.ok) {
    throw new Error(`Enqueue command failed: ${response.status}`);
  }
  const payload = (await response.json()) as { command: QueuedCommandRecord };
  return payload.command;
}

export async function getCommand(
  config: ZhiHandConfig,
  commandId: string
): Promise<QueuedCommandRecord> {
  const response = await fetch(
    `${config.controlPlaneEndpoint}/v1/credentials/${encodeURIComponent(config.credentialId)}/commands/${encodeURIComponent(commandId)}`,
    {
      headers: { "x-zhihand-controller-token": config.controllerToken },
    }
  );
  if (!response.ok) {
    throw new Error(`Get command failed: ${response.status}`);
  }
  const payload = (await response.json()) as { command: QueuedCommandRecord };
  return payload.command;
}

export function formatAckSummary(action: string, result: WaitForCommandAckResult): string {
  if (!result.acked) {
    return `Sent ${action}, waiting for ACK (timed out).`;
  }
  const ackStatus = result.command?.ack_status ?? "ok";
  return `Sent ${action}. ACK: ${ackStatus}`;
}

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
export declare function createControlCommand(params: ControlParams): QueuedControlCommand;
export declare function enqueueCommand(config: ZhiHandConfig, command: QueuedControlCommand): Promise<QueuedCommandRecord>;
export declare function getCommand(config: ZhiHandConfig, commandId: string): Promise<QueuedCommandRecord>;
export declare function formatAckSummary(action: string, result: WaitForCommandAckResult): string;

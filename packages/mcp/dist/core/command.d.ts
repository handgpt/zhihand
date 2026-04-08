import type { ZhiHandRuntimeConfig } from "./config.ts";
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
export declare function createControlCommand(params: ControlParams, platform?: string): QueuedControlCommand;
export interface SystemParams {
    action: string;
    text?: string;
}
export declare function createSystemCommand(params: SystemParams, platform?: string): QueuedControlCommand;
export declare function enqueueCommand(config: ZhiHandRuntimeConfig, command: QueuedControlCommand): Promise<QueuedCommandRecord>;
export declare function formatAckSummary(action: string, result: WaitForCommandAckResult): string;

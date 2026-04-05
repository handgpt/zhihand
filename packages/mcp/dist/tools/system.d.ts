/**
 * zhihand_system tool handler — system navigation + media controls.
 */
import type { ZhiHandRuntimeConfig } from "../core/config.ts";
import type { SystemParams } from "../core/command.ts";
type TextContent = {
    type: "text";
    text: string;
};
type ToolResult = {
    content: TextContent[];
    isError?: boolean;
};
export declare function executeSystem(config: ZhiHandRuntimeConfig, params: SystemParams, platform: string): Promise<ToolResult>;
export {};

import type { ZhiHandConfig } from "../core/config.ts";
import type { ControlParams } from "../core/command.ts";
type TextContent = {
    type: "text";
    text: string;
};
type ImageContent = {
    type: "image";
    data: string;
    mimeType: "image/jpeg";
};
type ToolContent = TextContent | ImageContent;
type ToolResult = {
    content: ToolContent[];
};
export declare function executeControl(config: ZhiHandConfig, params: ControlParams): Promise<ToolResult>;
export declare function executeScreenshot(config: ZhiHandConfig): Promise<ToolResult>;
export {};

import type { ZhiHandRuntimeConfig } from "../core/config.ts";
import type { ControlParams } from "../core/command.ts";
import type { ScreenshotResult } from "../core/screenshot.ts";
import type { Capabilities } from "../core/device.ts";
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
/**
 * Build a short human-readable warning for the LLM if the underlying
 * capability isn't ready, or if the last screenshot is stale.
 */
export declare function buildReadinessWarning(requiredCapability: "hid" | "screen" | "none", capabilities: Capabilities | null, screenshot: ScreenshotResult | null): string;
export declare function executeControl(config: ZhiHandRuntimeConfig, params: ControlParams, platform: string, capabilities: Capabilities | null): Promise<ToolResult>;
export declare function executeScreenshot(config: ZhiHandRuntimeConfig, capabilities: Capabilities | null): Promise<ToolResult>;
export {};

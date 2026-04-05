/**
 * zhihand_system tool handler — system navigation + media controls.
 *
 * Separated from zhihand_control to keep UI-control schema focused and
 * reduce LLM parameter hallucination (Gemini design review recommendation).
 */
import type { ZhiHandConfig } from "../core/config.ts";
import type { SystemParams } from "../core/command.ts";
type TextContent = {
    type: "text";
    text: string;
};
type ToolResult = {
    content: TextContent[];
};
export declare function executeSystem(config: ZhiHandConfig, params: SystemParams): Promise<ToolResult>;
export {};

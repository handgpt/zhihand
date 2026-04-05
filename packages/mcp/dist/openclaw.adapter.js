/**
 * OpenClaw Plugin adapter — thin wrapper that bridges OpenClaw Plugin API
 * to MCP core logic. All business logic lives in core/ and tools/.
 */
import { resolveConfig } from "./core/config.js";
import { executeControl } from "./tools/control.js";
import { handleScreenshot } from "./tools/screenshot.js";
import { handlePair } from "./tools/pair.js";
import { detectCLITools, formatDetectedTools } from "./cli/detect.js";
import { controlSchema, screenshotSchema, pairSchema } from "./tools/schemas.js";
import { registry } from "./core/registry.js";
function zodSchemaToJsonSchema(zodShape) {
    // Simplified conversion — OpenClaw uses JSON Schema-like parameter objects.
    // The actual Zod schemas are used for validation inside tool handlers.
    const properties = {};
    for (const [key, value] of Object.entries(zodShape)) {
        const v = value;
        properties[key] = {
            type: "string",
            description: v.description ?? key,
        };
    }
    return { type: "object", properties };
}
export function registerOpenClawTools(api, deviceName) {
    const log = (msg) => api.logger.info?.(msg);
    // Kick off registry in the background so runtime config resolution benefits.
    void registry.init().catch(() => { });
    // zhihand_control
    api.registerTool({
        name: "zhihand_control",
        label: "ZhiHand Control",
        description: "Control a paired phone: tap, swipe, type, scroll, screenshot, and more.",
        parameters: zodSchemaToJsonSchema(controlSchema),
        execute: async (_id, params) => {
            const config = resolveConfig(deviceName);
            const state = registry.get(config.credentialId);
            const platform = state?.profile?.platform ?? "unknown";
            const caps = state?.capabilities ?? null;
            const result = await executeControl(config, params, platform, caps);
            return result;
        },
    });
    // zhihand_screenshot
    api.registerTool({
        name: "zhihand_screenshot",
        label: "ZhiHand Screenshot",
        description: "Capture current phone screen without performing any action.",
        parameters: zodSchemaToJsonSchema(screenshotSchema),
        execute: async (_id, _params) => {
            const config = resolveConfig(deviceName);
            const state = registry.get(config.credentialId);
            const caps = state?.capabilities ?? null;
            const result = await handleScreenshot(config, caps);
            return result;
        },
    });
    // zhihand_pair
    api.registerTool({
        name: "zhihand_pair",
        label: "ZhiHand Pair",
        description: "Pair with a phone. Returns QR code and pairing URL.",
        parameters: zodSchemaToJsonSchema(pairSchema),
        execute: async (_id, params) => {
            const result = await handlePair(params);
            return result;
        },
    }, { optional: true });
    // detect command
    api.registerCommand({
        name: "zhihand-detect",
        description: "Detect available CLI tools (Claude Code, Codex, Gemini, OpenClaw)",
        handler: async () => {
            const tools = await detectCLITools();
            return { text: formatDetectedTools(tools) };
        },
    });
    log("[zhihand] OpenClaw tools registered via MCP core adapter");
}
export default registerOpenClawTools;

/**
 * OpenClaw Plugin adapter — thin wrapper that bridges OpenClaw Plugin API
 * to MCP core logic. All business logic lives in core/ and tools/.
 */
import { resolveConfig } from "./core/config.ts";
import { executeControl } from "./tools/control.ts";
import { handleScreenshot } from "./tools/screenshot.ts";
import { handlePair } from "./tools/pair.ts";
import { detectCLITools, formatDetectedTools } from "./cli/detect.ts";
import { controlSchema, screenshotSchema, pairSchema } from "./tools/schemas.ts";

type OpenClawLogger = {
  info?: (message: string) => void;
  warn?: (message: string) => void;
  error?: (message: string) => void;
};

type OpenClawRuntime = {
  state: { resolveStateDir: () => string };
  stt?: { transcribeAudioFile: (input: { path: string }) => Promise<{ text?: string } | string> };
};

type OpenClawToolRegistration = {
  name: string;
  label: string;
  description: string;
  parameters: Record<string, unknown>;
  execute: (id: string, params: Record<string, unknown>) => Promise<Record<string, unknown>>;
};

type OpenClawPluginApi = {
  logger: OpenClawLogger;
  runtime: OpenClawRuntime;
  pluginConfig?: Record<string, unknown>;
  registerService: (service: { id: string; start: () => Promise<void>; stop: () => Promise<void> }) => void;
  registerCommand: (command: {
    name: string;
    description: string;
    acceptsArgs?: boolean;
    handler: (ctx: { args?: string }) => Promise<{ text: string }>;
  }) => void;
  registerTool: (tool: OpenClawToolRegistration, options?: { optional?: boolean }) => void;
};

function zodSchemaToJsonSchema(zodShape: Record<string, unknown>): Record<string, unknown> {
  // Simplified conversion — OpenClaw uses JSON Schema-like parameter objects.
  // The actual Zod schemas are used for validation inside tool handlers.
  const properties: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(zodShape)) {
    const v = value as { description?: string; _def?: { typeName?: string } };
    properties[key] = {
      type: "string",
      description: v.description ?? key,
    };
  }
  return { type: "object", properties };
}

export function registerOpenClawTools(api: OpenClawPluginApi, deviceName?: string): void {
  const log = (msg: string) => api.logger.info?.(msg);

  // zhihand_control
  api.registerTool({
    name: "zhihand_control",
    label: "ZhiHand Control",
    description: "Control a paired phone: tap, swipe, type, scroll, screenshot, and more.",
    parameters: zodSchemaToJsonSchema(controlSchema),
    execute: async (_id, params) => {
      const config = resolveConfig(deviceName);
      const result = await executeControl(config, params as unknown as Parameters<typeof executeControl>[1]);
      return result as unknown as Record<string, unknown>;
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
      const result = await handleScreenshot(config);
      return result as unknown as Record<string, unknown>;
    },
  });

  // zhihand_pair
  api.registerTool(
    {
      name: "zhihand_pair",
      label: "ZhiHand Pair",
      description: "Pair with a phone. Returns QR code and pairing URL.",
      parameters: zodSchemaToJsonSchema(pairSchema),
      execute: async (_id, params) => {
        const result = await handlePair(params as { forceNew?: boolean });
        return result as unknown as Record<string, unknown>;
      },
    },
    { optional: true },
  );

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

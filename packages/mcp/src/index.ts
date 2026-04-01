import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { resolveConfig } from "./core/config.ts";
import { controlSchema, screenshotSchema, pairSchema } from "./tools/schemas.ts";
import { executeControl } from "./tools/control.ts";
import { handleScreenshot } from "./tools/screenshot.ts";
import { handlePair } from "./tools/pair.ts";

const PACKAGE_VERSION = "0.12.0";

export function createServer(deviceName?: string): McpServer {
  const server = new McpServer({
    name: "zhihand",
    version: PACKAGE_VERSION,
  });

  // zhihand_control — main phone control tool
  server.tool("zhihand_control", controlSchema, async (params) => {
    const config = resolveConfig(deviceName);
    return await executeControl(config, params);
  });

  // zhihand_screenshot — capture current screen without any action
  server.tool("zhihand_screenshot", screenshotSchema, async () => {
    const config = resolveConfig(deviceName);
    return await handleScreenshot(config);
  });

  // zhihand_pair — device pairing
  server.tool("zhihand_pair", pairSchema, async (params) => {
    return await handlePair(params);
  });

  return server;
}

export async function startStdioServer(deviceName?: string): Promise<void> {
  const server = createServer(deviceName);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

// Direct execution: start stdio server
const isDirectRun = process.argv[1]?.endsWith("index.ts") || process.argv[1]?.endsWith("index.js");
if (isDirectRun) {
  const deviceArg = process.argv.find((a) => a.startsWith("--device="))?.split("=")[1];
  startStdioServer(deviceArg ?? process.env.ZHIHAND_DEVICE).catch((err) => {
    process.stderr.write(`ZhiHand MCP Server failed: ${err.message}\n`);
    process.exit(1);
  });
}

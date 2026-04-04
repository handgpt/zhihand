import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { resolveConfig } from "./core/config.js";
import { controlSchema, screenshotSchema, pairSchema } from "./tools/schemas.js";
import { executeControl } from "./tools/control.js";
import { handleScreenshot } from "./tools/screenshot.js";
import { handlePair } from "./tools/pair.js";
import { getStaticContext, getDynamicContext, fetchDeviceProfile, buildControlToolDescription, buildScreenshotToolDescription, formatDeviceStatus, } from "./core/device.js";
export const PACKAGE_VERSION = "0.26.4";
export function createServer(deviceName) {
    const server = new McpServer({
        name: "zhihand",
        version: PACKAGE_VERSION,
    });
    // zhihand_control — main phone control tool
    // Description includes device info (platform, model, screen size) when available
    server.tool("zhihand_control", buildControlToolDescription(), controlSchema, async (params) => {
        const config = resolveConfig(deviceName);
        return await executeControl(config, params);
    });
    // zhihand_screenshot — capture current screen without any action
    server.tool("zhihand_screenshot", buildScreenshotToolDescription(), screenshotSchema, async () => {
        const config = resolveConfig(deviceName);
        return await handleScreenshot(config);
    });
    // zhihand_status — return device context for LLM to query on demand
    server.tool("zhihand_status", "Get device status: platform, model, OS version, screen size, battery, network, BLE, dark mode, storage, and more.", {}, async () => {
        return {
            content: [{
                    type: "text",
                    text: JSON.stringify(formatDeviceStatus(), null, 2),
                }],
        };
    });
    // zhihand_pair — device pairing
    server.tool("zhihand_pair", "Pair a new mobile device via QR code.", pairSchema, async (params) => {
        return await handlePair(params);
    });
    // device://profile — MCP resource for device profile
    server.resource("device-profile", "device://profile", { description: "Device static and dynamic context (platform, model, screen, battery, network, etc.)" }, async () => {
        const staticCtx = getStaticContext();
        const dynamicCtx = getDynamicContext();
        return {
            contents: [{
                    uri: "device://profile",
                    mimeType: "application/json",
                    text: JSON.stringify({ ...staticCtx, ...dynamicCtx }, null, 2),
                }],
        };
    });
    return server;
}
export async function startStdioServer(deviceName) {
    // Fetch device profile before creating server so tool descriptions have platform info
    try {
        const config = resolveConfig(deviceName);
        await fetchDeviceProfile(config);
    }
    catch {
        // Non-fatal — server will use generic descriptions
    }
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

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { controlSchema, systemSchema, screenshotSchema, pairSchema, listDevicesSchema, statusSchema, } from "./tools/schemas.js";
import { executeControl } from "./tools/control.js";
import { executeSystem } from "./tools/system.js";
import { handleScreenshot } from "./tools/screenshot.js";
import { handlePair } from "./tools/pair.js";
import { resolveTargetDevice } from "./tools/resolve.js";
import { buildControlToolDescription, buildSystemToolDescription, buildScreenshotToolDescription, formatDeviceStatus, extractDynamic, } from "./core/device.js";
import { registry } from "./core/registry.js";
export const PACKAGE_VERSION = "0.31.0";
function errorResult(message) {
    return { content: [{ type: "text", text: message }], isError: true };
}
export function createServer() {
    const server = new McpServer({
        name: "zhihand",
        version: PACKAGE_VERSION,
    });
    const multiUser = registry.isMultiUser();
    const controlTool = server.tool("zhihand_control", buildControlToolDescription(null, registry.listOnline(), multiUser), controlSchema, async (params) => {
        const resolved = resolveTargetDevice(params.device_id);
        if ("error" in resolved)
            return errorResult(resolved.error);
        const { state } = resolved;
        const cfg = registry.toRuntimeConfig(state);
        const platform = state.profile?.platform ?? "unknown";
        return await executeControl(cfg, params, platform, state.capabilities);
    });
    const systemTool = server.tool("zhihand_system", buildSystemToolDescription(null, registry.listOnline(), multiUser), systemSchema, async (params) => {
        const resolved = resolveTargetDevice(params.device_id);
        if ("error" in resolved)
            return errorResult(resolved.error);
        const { state } = resolved;
        const cfg = registry.toRuntimeConfig(state);
        const platform = state.profile?.platform ?? "unknown";
        return await executeSystem(cfg, params, platform);
    });
    const screenshotTool = server.tool("zhihand_screenshot", buildScreenshotToolDescription(null, registry.listOnline(), multiUser), screenshotSchema, async (params) => {
        const resolved = resolveTargetDevice(params.device_id);
        if ("error" in resolved)
            return errorResult(resolved.error);
        const { state } = resolved;
        const cfg = registry.toRuntimeConfig(state);
        return await handleScreenshot(cfg, state.capabilities);
    });
    server.tool("zhihand_status", "Get device status and capability readiness for a device. Returns curated fields (platform, model, OS, screen, battery, network, BLE, ...), a `capabilities` object with `ready`/`reason` for screen_sharing, hid, live_session, profile.age, AND a `raw` map of allowlisted device attributes. Pass device_id when multiple devices are online.", statusSchema, async (params) => {
        const resolved = resolveTargetDevice(params.device_id);
        if ("error" in resolved)
            return errorResult(resolved.error);
        return {
            content: [{
                    type: "text",
                    text: JSON.stringify(formatDeviceStatus(resolved.state), null, 2),
                }],
        };
    });
    server.tool("zhihand_list_devices", "List ALL configured ZhiHand devices with their online status. Returns device_id, label, platform, online, battery, is_default, last_active for each. Call this before zhihand_control/system/screenshot/status when multiple devices may be online.", listDevicesSchema, async () => {
        const mu = registry.isMultiUser();
        const defaultDev = registry.resolveDefault();
        const devices = registry.list().map((d) => ({
            device_id: d.credentialId,
            label: mu ? `[${d.userLabel}] ${d.label}` : d.label,
            platform: d.platform,
            online: d.online,
            battery: d.rawAttributes ? extractDynamic(d.rawAttributes).batteryLevel : null,
            is_default: d === defaultDev,
            last_active: d.lastSeenAtMs > 0 ? new Date(d.lastSeenAtMs).toISOString() : null,
        }));
        return {
            content: [{
                    type: "text",
                    text: JSON.stringify({ devices }, null, 2),
                }],
        };
    });
    server.tool("zhihand_pair", "Pair a new mobile device via QR code.", pairSchema, async (params) => {
        return await handlePair(params);
    });
    // Dynamic tool-description updates on online-set change.
    registry.subscribe(() => {
        const online = registry.listOnline();
        const mu = registry.isMultiUser();
        try {
            controlTool.update({ description: buildControlToolDescription(null, online, mu) });
        }
        catch { /* best-effort */ }
        try {
            systemTool.update({ description: buildSystemToolDescription(null, online, mu) });
        }
        catch { /* best-effort */ }
        try {
            screenshotTool.update({ description: buildScreenshotToolDescription(null, online, mu) });
        }
        catch { /* best-effort */ }
        try {
            server.server.sendToolListChanged();
        }
        catch { /* best-effort */ }
    });
    // device://profile — returns default online device
    server.resource("device-profile", "device://profile", { description: "Device static and dynamic context for the default online device." }, async () => {
        const state = registry.resolveDefault();
        if (!state) {
            return {
                contents: [{
                        uri: "device://profile",
                        mimeType: "application/json",
                        text: JSON.stringify({ error: "No device online" }, null, 2),
                    }],
            };
        }
        return {
            contents: [{
                    uri: "device://profile",
                    mimeType: "application/json",
                    text: JSON.stringify(formatDeviceStatus(state), null, 2),
                }],
        };
    });
    return server;
}
export async function startStdioServer() {
    await registry.init();
    const server = createServer();
    const transport = new StdioServerTransport();
    await server.connect(transport);
}
function setupShutdown() {
    const shutdown = () => {
        registry.shutdown();
        process.exit(0);
    };
    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
}
setupShutdown();
const isDirectRun = process.argv[1]?.endsWith("index.ts") || process.argv[1]?.endsWith("index.js");
if (isDirectRun) {
    startStdioServer().catch((err) => {
        process.stderr.write(`ZhiHand MCP Server failed: ${err.message}\n`);
        process.exit(1);
    });
}

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
export declare const PACKAGE_VERSION = "0.27.0";
export declare function createServer(deviceName?: string): McpServer;
export declare function startStdioServer(deviceName?: string): Promise<void>;

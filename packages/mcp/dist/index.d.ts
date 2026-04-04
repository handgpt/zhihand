import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
export declare const PACKAGE_VERSION = "0.26.4";
export declare function createServer(deviceName?: string): McpServer;
export declare function startStdioServer(deviceName?: string): Promise<void>;

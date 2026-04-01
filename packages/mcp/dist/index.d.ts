import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
export declare function createServer(deviceName?: string): McpServer;
export declare function startStdioServer(deviceName?: string): Promise<void>;

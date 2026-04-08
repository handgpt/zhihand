/**
 * Debug logger for ZhiHand daemon.
 *
 * Delegates to core/logger.ts for the debug flag, redaction, and output.
 * All output goes to stderr to keep stdout clean for MCP JSON-RPC.
 *
 * Enable with `zhihand start --debug`.
 */
export declare function setDebugEnabled(enabled: boolean): void;
export declare function isDebugEnabled(): boolean;
/** Debug log — only outputs when --debug is active. Writes to stderr with redaction. */
export declare function dbg(msg: string): void;

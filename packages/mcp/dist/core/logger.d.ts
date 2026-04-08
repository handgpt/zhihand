/**
 * Unified logger — all log output goes to stderr so stdout stays clean
 * for MCP JSON-RPC.
 *
 * All modules (core/, daemon/, tools/) should use this logger.
 * The daemon's dbg() in daemon/logger.ts delegates here for the debug flag.
 */
/**
 * Redact sensitive tokens from log messages.
 * Replaces Bearer tokens and controller_token values with <REDACTED>.
 */
export declare function redact(msg: string): string;
export declare const log: {
    info: (...args: unknown[]) => void;
    warn: (...args: unknown[]) => void;
    error: (...args: unknown[]) => void;
    debug: (...args: unknown[]) => void;
};
export declare function setDebugEnabled(v: boolean): void;
export declare function isDebugEnabled(): boolean;
/** Enable timestamps in log output (for daemon / CLI long-running processes). */
export declare function setTimestampEnabled(v: boolean): void;

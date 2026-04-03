/**
 * Debug logger for ZhiHand daemon.
 *
 * Enable with `zhihand start --debug` to see detailed request/response,
 * CLI spawn args, stdin/stdout data, SSE events, and timing information.
 */
export declare function setDebugEnabled(enabled: boolean): void;
export declare function isDebugEnabled(): boolean;
/** Debug log — only outputs when --debug is active. */
export declare function dbg(msg: string): void;

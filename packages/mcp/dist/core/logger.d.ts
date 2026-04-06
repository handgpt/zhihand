/**
 * Unified logger — all log output goes to stderr so stdout stays clean
 * for MCP JSON-RPC. Replaces ad-hoc process.stderr.write and dbg() calls
 * in core/ and tools/ code.
 *
 * The daemon has its own stdout-based log() in daemon/index.ts — that is
 * intentional (it writes to daemon.log). The daemon's debug logger
 * (daemon/logger.ts) remains for daemon-specific verbose output.
 */
export declare const log: {
    info: (...args: unknown[]) => void;
    warn: (...args: unknown[]) => void;
    error: (...args: unknown[]) => void;
    debug: (...args: unknown[]) => void;
};
export declare function setDebugEnabled(v: boolean): void;
export declare function isDebugEnabled(): boolean;

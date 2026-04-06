/**
 * Unified logger — all log output goes to stderr so stdout stays clean
 * for MCP JSON-RPC. Replaces ad-hoc process.stderr.write and dbg() calls
 * in core/ and tools/ code.
 *
 * The daemon has its own stdout-based log() in daemon/index.ts — that is
 * intentional (it writes to daemon.log). The daemon's debug logger
 * (daemon/logger.ts) remains for daemon-specific verbose output.
 */
let debugEnabled = false;
export const log = {
    info: (...args) => {
        process.stderr.write(`[info]  ${args.map(String).join(" ")}\n`);
    },
    warn: (...args) => {
        process.stderr.write(`[warn]  ${args.map(String).join(" ")}\n`);
    },
    error: (...args) => {
        process.stderr.write(`[error] ${args.map(String).join(" ")}\n`);
    },
    debug: (...args) => {
        if (debugEnabled) {
            process.stderr.write(`[debug] ${args.map(String).join(" ")}\n`);
        }
    },
};
export function setDebugEnabled(v) {
    debugEnabled = v;
}
export function isDebugEnabled() {
    return debugEnabled;
}

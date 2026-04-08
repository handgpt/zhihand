/**
 * Unified logger — all log output goes to stderr so stdout stays clean
 * for MCP JSON-RPC.
 *
 * All modules (core/, daemon/, tools/) should use this logger.
 * The daemon's dbg() in daemon/logger.ts delegates here for the debug flag.
 */
let debugEnabled = false;
let timestampEnabled = false;
// ── Token redaction ──────────────────────────────────────
const REDACT_PATTERNS = [
    // Bearer tokens in headers / JSON
    /(Bearer\s+)[^\s"',}]+/gi,
    // controller_token in JSON / key=value
    /(controller_token["']?\s*[:=]\s*["']?)[^\s"',}]+/gi,
];
/**
 * Redact sensitive tokens from log messages.
 * Replaces Bearer tokens and controller_token values with <REDACTED>.
 */
export function redact(msg) {
    let result = msg;
    for (const pattern of REDACT_PATTERNS) {
        result = result.replace(pattern, "$1<REDACTED>");
    }
    return result;
}
// ── Logger ───────────────────────────────────────────────
function prefix(level) {
    if (timestampEnabled) {
        return `[${new Date().toLocaleTimeString()}] [${level}] `;
    }
    return `[${level.padEnd(5)}] `;
}
export const log = {
    info: (...args) => {
        process.stderr.write(`${prefix("info")}${redact(args.map(String).join(" "))}\n`);
    },
    warn: (...args) => {
        process.stderr.write(`${prefix("warn")}${redact(args.map(String).join(" "))}\n`);
    },
    error: (...args) => {
        process.stderr.write(`${prefix("error")}${redact(args.map(String).join(" "))}\n`);
    },
    debug: (...args) => {
        if (debugEnabled) {
            process.stderr.write(`${prefix("debug")}${redact(args.map(String).join(" "))}\n`);
        }
    },
};
export function setDebugEnabled(v) {
    debugEnabled = v;
}
export function isDebugEnabled() {
    return debugEnabled;
}
/** Enable timestamps in log output (for daemon / CLI long-running processes). */
export function setTimestampEnabled(v) {
    timestampEnabled = v;
}

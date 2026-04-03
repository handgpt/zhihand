/**
 * Debug logger for ZhiHand daemon.
 *
 * Enable with `zhihand start --debug` to see detailed request/response,
 * CLI spawn args, stdin/stdout data, SSE events, and timing information.
 */
let debugEnabled = false;
export function setDebugEnabled(enabled) {
    debugEnabled = enabled;
}
export function isDebugEnabled() {
    return debugEnabled;
}
function ts() {
    return new Date().toLocaleTimeString();
}
/** Debug log — only outputs when --debug is active. */
export function dbg(msg) {
    if (!debugEnabled)
        return;
    process.stdout.write(`[${ts()}] [DEBUG] ${msg}\n`);
}

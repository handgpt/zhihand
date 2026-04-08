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
export function redact(msg: string): string {
  let result = msg;
  for (const pattern of REDACT_PATTERNS) {
    result = result.replace(pattern, "$1<REDACTED>");
  }
  return result;
}

// ── Logger ───────────────────────────────────────────────

function prefix(level: string): string {
  if (timestampEnabled) {
    return `[${new Date().toLocaleTimeString()}] [${level}] `;
  }
  return `[${level.padEnd(5)}] `;
}

export const log = {
  info: (...args: unknown[]): void => {
    process.stderr.write(`${prefix("info")}${redact(args.map(String).join(" "))}\n`);
  },
  warn: (...args: unknown[]): void => {
    process.stderr.write(`${prefix("warn")}${redact(args.map(String).join(" "))}\n`);
  },
  error: (...args: unknown[]): void => {
    process.stderr.write(`${prefix("error")}${redact(args.map(String).join(" "))}\n`);
  },
  debug: (...args: unknown[]): void => {
    if (debugEnabled) {
      process.stderr.write(`${prefix("debug")}${redact(args.map(String).join(" "))}\n`);
    }
  },
};

export function setDebugEnabled(v: boolean): void {
  debugEnabled = v;
}

export function isDebugEnabled(): boolean {
  return debugEnabled;
}

/** Enable timestamps in log output (for daemon / CLI long-running processes). */
export function setTimestampEnabled(v: boolean): void {
  timestampEnabled = v;
}

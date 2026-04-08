/**
 * Debug logger for ZhiHand daemon.
 *
 * Delegates to core/logger.ts for the debug flag, redaction, and output.
 * All output goes to stderr to keep stdout clean for MCP JSON-RPC.
 *
 * Enable with `zhihand start --debug`.
 */

import {
  log,
  setDebugEnabled as coreSetDebug,
  isDebugEnabled as coreIsDebug,
} from "../core/logger.ts";

export function setDebugEnabled(enabled: boolean): void {
  coreSetDebug(enabled);
}

export function isDebugEnabled(): boolean {
  return coreIsDebug();
}

/** Debug log — only outputs when --debug is active. Writes to stderr with redaction. */
export function dbg(msg: string): void {
  if (!coreIsDebug()) return;
  log.debug(msg);
}

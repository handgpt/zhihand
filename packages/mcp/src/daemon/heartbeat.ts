import { dbg } from "./logger.ts";

const HEARTBEAT_INTERVAL = 30_000; // 30s
const HEARTBEAT_RETRY_INTERVAL = 5_000; // 5s on failure

let heartbeatTimer: ReturnType<typeof setTimeout> | undefined;
let retryTimer: ReturnType<typeof setTimeout> | undefined;
let stopped = true;

/** Brain metadata included in every heartbeat, so the app always knows the current backend/model. */
export interface BrainMeta {
  backend?: string | null;  // "gemini" | "claudecode" | "codex"
  model?: string | null;    // "flash" | "sonnet" | "gpt-5.4-mini" | ...
}

/** Plugin-level heartbeat target. Uses edgeId + pluginSecret instead of per-credential auth. */
export interface HeartbeatTarget {
  controlPlaneEndpoint: string;
  edgeId: string;
  pluginSecret: string;
}

let currentMeta: BrainMeta = {};

/** Update the backend/model metadata that will be sent with the next heartbeat. */
export function setBrainMeta(meta: BrainMeta): void {
  currentMeta = meta;
}

function buildUrl(target: HeartbeatTarget): string {
  return `${target.controlPlaneEndpoint}/v1/plugins/${encodeURIComponent(target.edgeId)}/brain-status`;
}

async function sendHeartbeat(target: HeartbeatTarget, online: boolean): Promise<boolean> {
  try {
    const body: Record<string, unknown> = { plugin_online: online };
    if (currentMeta.backend) body.backend = currentMeta.backend;
    if (currentMeta.model) body.model = currentMeta.model;
    const url = buildUrl(target);
    dbg(`[heartbeat] POST ${url} body=${JSON.stringify(body)}`);
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${target.pluginSecret}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });
    dbg(`[heartbeat] Response: ${response.status} ${response.statusText}`);
    return response.ok;
  } catch (err) {
    dbg(`[heartbeat] Error: ${(err as Error).message}`);
    return false;
  }
}

export async function sendBrainOnline(target: HeartbeatTarget): Promise<boolean> {
  return sendHeartbeat(target, true);
}

export async function sendBrainOffline(target: HeartbeatTarget): Promise<boolean> {
  return sendHeartbeat(target, false);
}

export function startHeartbeatLoop(target: HeartbeatTarget, log: (msg: string) => void): void {
  let retrying = false;
  stopped = false;

  async function beat(): Promise<void> {
    // Skip main-timer beats while retry loop is active (avoids overlap & flapping)
    if (retrying || stopped) return;

    const ok = await sendBrainOnline(target);
    if (stopped) return; // check after await — stopHeartbeatLoop() may have been called
    if (ok) {
      scheduleNextBeat();
      return;
    }

    // Enter retry mode
    retrying = true;
    log("[heartbeat] Failed, retrying every 5s...");
    scheduleRetry();
  }

  /** Recursive setTimeout for retry — waits for fetch to settle before scheduling next. */
  function scheduleRetry(): void {
    if (stopped) return;
    retryTimer = setTimeout(async () => {
      if (!retrying || stopped) return;
      const recovered = await sendBrainOnline(target);
      if (stopped) return; // check after await
      if (recovered) {
        retrying = false;
        retryTimer = undefined;
        log("[heartbeat] Recovered.");
        // Resume normal beat cycle
        scheduleNextBeat();
        return;
      }
      // Still failing — schedule another retry
      if (retrying && !stopped) scheduleRetry();
    }, HEARTBEAT_RETRY_INTERVAL);
  }

  /** Schedule next normal heartbeat using setTimeout (not setInterval, to avoid overlap). */
  function scheduleNextBeat(): void {
    if (stopped) return;
    if (heartbeatTimer) clearTimeout(heartbeatTimer);
    heartbeatTimer = setTimeout(beat, HEARTBEAT_INTERVAL);
  }

  // Immediate first heartbeat
  beat();
}

export function stopHeartbeatLoop(): void {
  stopped = true;
  if (heartbeatTimer) {
    clearTimeout(heartbeatTimer);
    heartbeatTimer = undefined;
  }
  if (retryTimer) {
    clearTimeout(retryTimer);
    retryTimer = undefined;
  }
}

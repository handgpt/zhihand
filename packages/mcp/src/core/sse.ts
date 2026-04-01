import type { ZhiHandConfig } from "./config.ts";
import type { QueuedCommandRecord, WaitForCommandAckResult } from "./command.ts";
import { getCommand } from "./command.ts";

export interface SSEEvent {
  id: string;
  topic: string;
  kind: string;
  credential_id: string;
  command?: QueuedCommandRecord;
  sequence: number;
}

// Per-commandId callback registry for SSE-based ACK
const ackCallbacks = new Map<string, (command: QueuedCommandRecord) => void>();

export function handleSSEEvent(event: SSEEvent): void {
  if (event.kind === "command.acked" && event.command) {
    const callback = ackCallbacks.get(event.command.id);
    if (callback) {
      callback(event.command);
      ackCallbacks.delete(event.command.id);
    }
  }
}

export function subscribeToCommandAck(
  commandId: string,
  callback: (cmd: QueuedCommandRecord) => void
): () => void {
  ackCallbacks.set(commandId, callback);
  return () => { ackCallbacks.delete(commandId); };
}

/**
 * Wait for command ACK via SSE push.
 * Falls back to polling if SSE is not active.
 */
export async function waitForCommandAck(
  config: ZhiHandConfig,
  options: { commandId: string; timeoutMs?: number; signal?: AbortSignal }
): Promise<WaitForCommandAckResult> {
  const timeoutMs = options.timeoutMs ?? 15_000;

  // Try SSE-based ACK first (if callbacks are being dispatched by an active SSE stream)
  return new Promise<WaitForCommandAckResult>((resolve, reject) => {
    let resolved = false;
    let pollInterval: ReturnType<typeof setInterval> | undefined;

    const timeout = setTimeout(() => {
      cleanup();
      resolve({ acked: false });
    }, timeoutMs);

    const unsubscribe = subscribeToCommandAck(options.commandId, (ackedCommand) => {
      if (resolved) return;
      resolved = true;
      cleanup();
      resolve({ acked: true, command: ackedCommand });
    });

    // Also poll as fallback (SSE may not be active)
    pollInterval = setInterval(async () => {
      if (resolved) return;
      try {
        const cmd = await getCommand(config, options.commandId);
        if (cmd.acked_at) {
          resolved = true;
          cleanup();
          resolve({ acked: true, command: cmd });
        }
      } catch {
        // Polling failure is non-fatal; SSE or next poll may succeed
      }
    }, 500);

    options.signal?.addEventListener("abort", () => {
      cleanup();
      reject(new Error("The operation was aborted"));
    }, { once: true });

    function cleanup() {
      clearTimeout(timeout);
      unsubscribe();
      if (pollInterval) clearInterval(pollInterval);
    }
  });
}

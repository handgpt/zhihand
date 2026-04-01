const HEARTBEAT_INTERVAL = 30_000; // 30s
const HEARTBEAT_RETRY_INTERVAL = 5_000; // 5s on failure
let heartbeatTimer;
let retryTimer;
function buildUrl(config) {
    return `${config.controlPlaneEndpoint}/v1/credentials/${encodeURIComponent(config.credentialId)}/brain-status`;
}
async function sendHeartbeat(config, online) {
    try {
        const response = await fetch(buildUrl(config), {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "x-zhihand-controller-token": config.controllerToken,
            },
            body: JSON.stringify({ plugin_online: online }),
            signal: AbortSignal.timeout(10_000),
        });
        return response.ok;
    }
    catch {
        return false;
    }
}
export async function sendBrainOnline(config) {
    return sendHeartbeat(config, true);
}
export async function sendBrainOffline(config) {
    return sendHeartbeat(config, false);
}
export function startHeartbeatLoop(config, log) {
    let retrying = false;
    async function beat() {
        const ok = await sendBrainOnline(config);
        if (!ok && !retrying) {
            retrying = true;
            log("[heartbeat] Failed, retrying every 5s...");
            // Fast retry to recover before 40s TTL
            retryTimer = setInterval(async () => {
                const recovered = await sendBrainOnline(config);
                if (recovered) {
                    retrying = false;
                    if (retryTimer) {
                        clearInterval(retryTimer);
                        retryTimer = undefined;
                    }
                    log("[heartbeat] Recovered.");
                }
            }, HEARTBEAT_RETRY_INTERVAL);
        }
    }
    // Immediate first heartbeat
    beat();
    heartbeatTimer = setInterval(beat, HEARTBEAT_INTERVAL);
}
export function stopHeartbeatLoop() {
    if (heartbeatTimer) {
        clearInterval(heartbeatTimer);
        heartbeatTimer = undefined;
    }
    if (retryTimer) {
        clearInterval(retryTimer);
        retryTimer = undefined;
    }
}

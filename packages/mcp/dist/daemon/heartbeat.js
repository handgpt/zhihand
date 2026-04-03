const HEARTBEAT_INTERVAL = 30_000; // 30s
const HEARTBEAT_RETRY_INTERVAL = 5_000; // 5s on failure
let heartbeatTimer;
let retryTimer;
let stopped = true;
let currentMeta = {};
/** Update the backend/model metadata that will be sent with the next heartbeat. */
export function setBrainMeta(meta) {
    currentMeta = meta;
}
function buildUrl(config) {
    return `${config.controlPlaneEndpoint}/v1/credentials/${encodeURIComponent(config.credentialId)}/brain-status`;
}
async function sendHeartbeat(config, online) {
    try {
        const body = { plugin_online: online };
        if (currentMeta.backend)
            body.backend = currentMeta.backend;
        if (currentMeta.model)
            body.model = currentMeta.model;
        const response = await fetch(buildUrl(config), {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "x-zhihand-controller-token": config.controllerToken,
            },
            body: JSON.stringify(body),
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
    stopped = false;
    async function beat() {
        // Skip main-timer beats while retry loop is active (avoids overlap & flapping)
        if (retrying || stopped)
            return;
        const ok = await sendBrainOnline(config);
        if (stopped)
            return; // check after await — stopHeartbeatLoop() may have been called
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
    function scheduleRetry() {
        if (stopped)
            return;
        retryTimer = setTimeout(async () => {
            if (!retrying || stopped)
                return;
            const recovered = await sendBrainOnline(config);
            if (stopped)
                return; // check after await
            if (recovered) {
                retrying = false;
                retryTimer = undefined;
                log("[heartbeat] Recovered.");
                // Resume normal beat cycle
                scheduleNextBeat();
                return;
            }
            // Still failing — schedule another retry
            if (retrying && !stopped)
                scheduleRetry();
        }, HEARTBEAT_RETRY_INTERVAL);
    }
    /** Schedule next normal heartbeat using setTimeout (not setInterval, to avoid overlap). */
    function scheduleNextBeat() {
        if (stopped)
            return;
        if (heartbeatTimer)
            clearTimeout(heartbeatTimer);
        heartbeatTimer = setTimeout(beat, HEARTBEAT_INTERVAL);
    }
    // Immediate first heartbeat
    beat();
}
export function stopHeartbeatLoop() {
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

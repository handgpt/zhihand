import { dbg } from "../daemon/logger.js";
// Snapshot is considered stale if the server-reported age exceeds this
// threshold. Configurable via env ZHIHAND_SNAPSHOT_MAX_AGE_MS.
// Default 5s: typical HID command + capture + upload is well under 2s;
// anything beyond 5s suggests the phone is no longer actively sharing.
export function getSnapshotStaleThresholdMs() {
    const raw = process.env.ZHIHAND_SNAPSHOT_MAX_AGE_MS;
    if (raw) {
        const n = Number(raw);
        if (Number.isFinite(n) && n > 0)
            return n;
    }
    return 5000;
}
function parseIntHeader(h) {
    if (!h)
        return -1;
    const n = Number(h);
    return Number.isFinite(n) ? n : -1;
}
export async function fetchScreenshot(config) {
    const controller = new AbortController();
    const timeoutMs = config.timeoutMs ?? 10_000;
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const url = `${config.controlPlaneEndpoint}/v1/credentials/${encodeURIComponent(config.credentialId)}/screen`;
    dbg(`[screenshot] GET ${url} timeout=${timeoutMs}ms`);
    const t0 = Date.now();
    try {
        const response = await fetch(url, {
            method: "GET",
            headers: {
                "x-zhihand-controller-token": config.controllerToken,
                "Accept": "image/jpeg",
            },
            signal: controller.signal,
        });
        if (!response.ok) {
            dbg(`[screenshot] Failed: ${response.status} ${response.statusText}`);
            throw new Error(`Screenshot fetch failed: ${response.status}`);
        }
        const buf = Buffer.from(await response.arrayBuffer());
        const ageMs = parseIntHeader(response.headers.get("x-snapshot-age"));
        const width = parseIntHeader(response.headers.get("x-snapshot-width"));
        const height = parseIntHeader(response.headers.get("x-snapshot-height"));
        const sequence = parseIntHeader(response.headers.get("x-snapshot-sequence"));
        const capturedAt = response.headers.get("x-snapshot-captured-at");
        const threshold = getSnapshotStaleThresholdMs();
        const stale = ageMs >= 0 && ageMs > threshold;
        dbg(`[screenshot] OK: ${(buf.length / 1024).toFixed(0)}KB in ${Date.now() - t0}ms, age=${ageMs}ms, stale=${stale}`);
        return {
            buffer: buf,
            ageMs,
            width: Math.max(width, 0),
            height: Math.max(height, 0),
            capturedAt,
            sequence,
            stale,
        };
    }
    finally {
        clearTimeout(timeout);
    }
}
// Backward-compatible wrapper — returns only the Buffer.
// New code should prefer fetchScreenshot() for staleness info.
export async function fetchScreenshotBinary(config) {
    const res = await fetchScreenshot(config);
    return res.buffer;
}

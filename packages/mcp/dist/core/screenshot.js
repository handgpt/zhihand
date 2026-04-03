import { dbg } from "../daemon/logger.js";
export async function fetchScreenshotBinary(config) {
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
        dbg(`[screenshot] OK: ${(buf.length / 1024).toFixed(0)}KB in ${Date.now() - t0}ms`);
        return buf;
    }
    finally {
        clearTimeout(timeout);
    }
}

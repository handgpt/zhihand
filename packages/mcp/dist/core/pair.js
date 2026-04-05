import QRCode from "qrcode";
import { addDevice, ensureZhiHandDir, saveState } from "./config.js";
import { fetchDeviceProfileOnce, extractStatic } from "./device.js";
const DEFAULT_SCOPES = [
    "observe",
    "session.control",
    "screen.read",
    "screen.capture",
    "ble.control",
];
export async function registerPlugin(endpoint, options) {
    const response = await fetch(`${endpoint}/v1/plugins`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            adapter_kind: options.adapterKind ?? "mcp",
            display_name: options.displayName ?? "ZhiHand MCP Server",
            stable_identity: options.stableIdentity,
        }),
    });
    if (!response.ok) {
        throw new Error(`Register plugin failed: ${response.status} ${await response.text()}`);
    }
    const payload = (await response.json());
    return payload.plugin;
}
export async function createPairingSession(endpoint, options) {
    const response = await fetch(`${endpoint}/v1/pairing/sessions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            edge_id: options.edgeId,
            ttl_seconds: options.ttlSeconds ?? 600,
            requested_scopes: options.requestedScopes ?? DEFAULT_SCOPES,
        }),
    });
    if (!response.ok) {
        throw new Error(`Create pairing session failed: ${response.status}`);
    }
    const payload = (await response.json());
    return {
        ...payload.session,
        controller_token: payload.controller_token ?? payload.session.controller_token,
    };
}
export async function getPairingSession(endpoint, sessionId) {
    const response = await fetch(`${endpoint}/v1/pairing/sessions/${encodeURIComponent(sessionId)}`);
    if (!response.ok) {
        throw new Error(`Get pairing session failed: ${response.status}`);
    }
    const payload = (await response.json());
    return payload.session;
}
export async function waitForPairingClaim(endpoint, sessionId, timeoutMs = 600_000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        const session = await getPairingSession(endpoint, sessionId);
        if (session.status === "claimed" && session.credential_id) {
            return session;
        }
        if (session.status === "expired") {
            throw new Error("Pairing session expired.");
        }
        await new Promise((r) => setTimeout(r, 2000));
    }
    throw new Error("Pairing timeout.");
}
export async function renderPairingQRCode(url) {
    return QRCode.toString(url, { type: "utf8", margin: 2 });
}
/**
 * Drive the full interactive pairing flow. Saves a new device record into the
 * v2 config on success. Label defaults to the device model (fetched post-claim)
 * and falls back to the supplied preferredLabel or timestamp.
 */
export async function executePairing(endpoint, edgeId, preferredLabel) {
    const plugin = await registerPlugin(endpoint, {
        stableIdentity: edgeId,
        displayName: preferredLabel ? `ZhiHand MCP — ${preferredLabel}` : "ZhiHand MCP Server",
    });
    const registeredEdgeId = plugin.edge_id;
    const session = await createPairingSession(endpoint, { edgeId: registeredEdgeId });
    saveState({
        sessionId: session.id,
        controllerToken: session.controller_token,
        edgeId: session.edge_id,
        pairUrl: session.pair_url,
        status: "pending",
        expiresAt: session.expires_at,
    });
    const qr = await renderPairingQRCode(session.pair_url);
    console.log(qr);
    console.log(`Open this URL on your phone to pair:\n  ${session.pair_url}\n`);
    console.log(`Expires at: ${session.expires_at}`);
    console.log("Waiting for phone to scan...\n");
    const claimed = await waitForPairingClaim(endpoint, session.id);
    const credentialId = claimed.credential_id;
    const controllerToken = claimed.controller_token ?? session.controller_token;
    const runtimeCfg = {
        controlPlaneEndpoint: endpoint,
        credentialId,
        controllerToken,
        timeoutMs: 10_000,
    };
    // Try to fetch profile to infer label/platform
    let label = preferredLabel ?? "";
    let platform = "unknown";
    try {
        const fetched = await fetchDeviceProfileOnce(runtimeCfg);
        if (fetched) {
            const st = extractStatic(fetched.rawAttrs);
            if (!label)
                label = st.model && st.model !== "unknown" ? st.model : "";
            if (st.platform === "ios" || st.platform === "android")
                platform = st.platform;
        }
    }
    catch {
        // fall through
    }
    if (!label)
        label = `device-${Date.now().toString(36)}`;
    const now = new Date().toISOString();
    const record = {
        credential_id: credentialId,
        controller_token: controllerToken,
        endpoint,
        label,
        platform,
        paired_at: now,
        last_seen_at: now,
    };
    addDevice(record, true);
    ensureZhiHandDir();
    saveState({
        sessionId: session.id,
        controllerToken,
        edgeId: session.edge_id,
        credentialId,
        pairUrl: session.pair_url,
        status: "claimed",
    });
    return { session: claimed, record };
}
export function formatPairingStatus(record) {
    if (!record)
        return "Not paired. Run 'zhihand pair' to connect a device.";
    return [
        `Paired: ${record.label} (${record.platform})`,
        `Credential: ${record.credential_id}`,
        `Endpoint: ${record.endpoint}`,
        `Paired at: ${record.paired_at}`,
    ].join("\n");
}

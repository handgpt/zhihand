import { loadConfig } from "../core/config.js";
import { createPairingSession, registerPlugin, renderPairingQRCode, } from "../core/pair.js";
const DEFAULT_ENDPOINT = "https://api.zhihand.com";
const DEFAULT_EDGE_ID_PREFIX = "mcp-";
function generateEdgeId() {
    return `${DEFAULT_EDGE_ID_PREFIX}${Date.now().toString(36)}`;
}
export async function handlePair(params, endpoint) {
    const resolvedEndpoint = endpoint ?? DEFAULT_ENDPOINT;
    if (!params.forceNew) {
        const cfg = loadConfig();
        const records = Object.values(cfg.devices);
        if (records.length > 0) {
            const lines = [
                "Already paired with:",
                "",
                ...records.map((r) => `  - ${r.credential_id} (${r.label}, ${r.platform}) via ${r.endpoint}`),
                "",
                "Pass forceNew=true to pair another device.",
            ];
            return { content: [{ type: "text", text: lines.join("\n") }] };
        }
    }
    const stableIdentity = generateEdgeId();
    const plugin = await registerPlugin(resolvedEndpoint, { stableIdentity });
    const session = await createPairingSession(resolvedEndpoint, { edgeId: plugin.edge_id });
    const qr = await renderPairingQRCode(session.pair_url);
    return {
        content: [
            {
                type: "text",
                text: [
                    "Scan QR code or open URL on your phone to pair:",
                    "",
                    qr,
                    "",
                    `URL: ${session.pair_url}`,
                    `Expires at: ${session.expires_at}`,
                    "",
                    "Waiting for phone to scan...",
                    "(Call zhihand_pair again after scanning to check status)",
                ].join("\n"),
            },
        ],
    };
}

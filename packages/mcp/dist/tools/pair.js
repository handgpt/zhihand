import { listUsers } from "../core/config.js";
import { createPairingSession, registerPlugin, renderPairingQRCode, createUser, } from "../core/pair.js";
import { resolveDefaultEndpoint } from "../core/config.js";
export async function handlePair(params) {
    const endpoint = resolveDefaultEndpoint();
    const users = listUsers();
    if (!params.forceNew && users.length > 0) {
        const lines = [
            "Already paired with:",
            "",
            ...users.map((u) => `  User: ${u.label} (${u.user_id})\n` +
                u.devices.map((d) => `    - ${d.credential_id} (${d.label}, ${d.platform})`).join("\n")),
            "",
            "Pass forceNew=true to pair another device.",
        ];
        return { content: [{ type: "text", text: lines.join("\n") }] };
    }
    // Create a new user for MCP-tool pairing
    const label = `MCP-${Date.now().toString(36)}`;
    const userResp = await createUser(endpoint, label);
    const stableIdentity = `mcp-${Date.now().toString(36)}`;
    const plugin = await registerPlugin(endpoint, { stableIdentity });
    const session = await createPairingSession(endpoint, userResp.user_id, userResp.controller_token, plugin.edge_id, 300);
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

import { loadDefaultCredential } from "../core/config.ts";
import {
  createPairingSession,
  registerPlugin,
  renderPairingQRCode,
  formatPairingStatus,
} from "../core/pair.ts";

const DEFAULT_ENDPOINT = "https://api.zhihand.com";
const DEFAULT_EDGE_ID_PREFIX = "mcp-";

function generateEdgeId(): string {
  return `${DEFAULT_EDGE_ID_PREFIX}${Date.now().toString(36)}`;
}

export async function handlePair(
  params: { forceNew?: boolean },
  endpoint?: string
) {
  const resolvedEndpoint = endpoint ?? DEFAULT_ENDPOINT;

  // Check existing credential
  if (!params.forceNew) {
    const existing = loadDefaultCredential();
    if (existing) {
      return {
        content: [
          { type: "text" as const, text: formatPairingStatus(existing) },
        ],
      };
    }
  }

  // Register plugin first — server requires a known edge_id before pairing
  const stableIdentity = generateEdgeId();
  const plugin = await registerPlugin(resolvedEndpoint, {
    stableIdentity,
  });

  // Create new pairing session with the registered edge_id
  const session = await createPairingSession(resolvedEndpoint, {
    edgeId: plugin.edge_id,
  });

  const qr = await renderPairingQRCode(session.pair_url);

  return {
    content: [
      {
        type: "text" as const,
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

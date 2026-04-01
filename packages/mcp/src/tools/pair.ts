import { loadDefaultCredential } from "../core/config.ts";
import {
  createPairingSession,
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
): Promise<{ content: Array<{ type: string; text?: string }> }> {
  const resolvedEndpoint = endpoint ?? DEFAULT_ENDPOINT;

  // Check existing credential
  if (!params.forceNew) {
    const existing = loadDefaultCredential();
    if (existing) {
      return {
        content: [
          { type: "text", text: formatPairingStatus(existing) },
        ],
      };
    }
  }

  // Create new pairing session
  const session = await createPairingSession(resolvedEndpoint, {
    edgeId: generateEdgeId(),
  });

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

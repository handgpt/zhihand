import QRCode from "qrcode";
import type { ZhiHandConfig, DeviceCredential } from "./config.ts";
import { saveCredential, loadDefaultCredential, ensureZhiHandDir, saveState } from "./config.ts";

export interface PluginRecord {
  id: string;
  edge_id: string;
  adapter_kind: string;
  display_name?: string;
  stable_identity?: string;
  status: string;
  created_at: string;
}

export interface PairingSession {
  id: string;
  pair_url: string;
  qr_payload: string;
  controller_token?: string;
  edge_id: string;
  status: "pending" | "claimed" | "expired" | string;
  credential_id?: string;
  expires_at: string;
  requested_scopes?: string[];
}

export interface CreatePairingOptions {
  edgeId: string;
  ttlSeconds?: number;
  requestedScopes?: string[];
}

const DEFAULT_SCOPES = [
  "observe",
  "session.control",
  "screen.read",
  "screen.capture",
  "ble.control",
];

/**
 * Register this MCP instance as a plugin with the server.
 * Server requires a registered plugin (edge_id) before pairing can begin.
 * Idempotent — re-registering with the same stable_identity returns the existing plugin.
 */
export async function registerPlugin(
  endpoint: string,
  options: {
    stableIdentity: string;
    displayName?: string;
    adapterKind?: string;
  }
): Promise<PluginRecord> {
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
  const payload = (await response.json()) as { plugin: PluginRecord };
  return payload.plugin;
}

export async function createPairingSession(
  endpoint: string,
  options: CreatePairingOptions
): Promise<PairingSession> {
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
  const payload = (await response.json()) as { session: PairingSession; controller_token?: string };
  return {
    ...payload.session,
    controller_token: payload.controller_token ?? payload.session.controller_token,
  };
}

export async function getPairingSession(
  endpoint: string,
  sessionId: string
): Promise<PairingSession> {
  const response = await fetch(
    `${endpoint}/v1/pairing/sessions/${encodeURIComponent(sessionId)}`
  );
  if (!response.ok) {
    throw new Error(`Get pairing session failed: ${response.status}`);
  }
  const payload = (await response.json()) as { session: PairingSession };
  return payload.session;
}

export async function waitForPairingClaim(
  endpoint: string,
  sessionId: string,
  timeoutMs: number = 600_000
): Promise<PairingSession> {
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

export async function renderPairingQRCode(url: string): Promise<string> {
  return QRCode.toString(url, { type: "utf8", margin: 1 });
}

export async function executePairing(
  endpoint: string,
  edgeId: string,
  deviceName?: string
): Promise<{ session: PairingSession; credential: DeviceCredential }> {
  // Step 0: Register plugin first — server requires a known edge_id before pairing.
  // Uses edgeId as stable_identity so re-runs are idempotent.
  const plugin = await registerPlugin(endpoint, {
    stableIdentity: edgeId,
    displayName: deviceName ? `ZhiHand MCP — ${deviceName}` : "ZhiHand MCP Server",
  });
  const registeredEdgeId = plugin.edge_id;

  const session = await createPairingSession(endpoint, { edgeId: registeredEdgeId });

  // Save pending state
  saveState({
    sessionId: session.id,
    controllerToken: session.controller_token,
    edgeId: session.edge_id,
    pairUrl: session.pair_url,
    status: "pending",
    expiresAt: session.expires_at,
  });

  // Display QR code and pairing URL
  const qr = await renderPairingQRCode(session.pair_url);
  console.log(qr);
  console.log(`Open this URL on your phone to pair:\n  ${session.pair_url}\n`);
  console.log(`Expires at: ${session.expires_at}`);
  console.log("Waiting for phone to scan...\n");

  // Wait for phone to scan
  const claimed = await waitForPairingClaim(endpoint, session.id);

  const credential: DeviceCredential = {
    credentialId: claimed.credential_id!,
    controllerToken: claimed.controller_token ?? session.controller_token!,
    endpoint,
    deviceName: deviceName ?? `device_${Date.now()}`,
    pairedAt: new Date().toISOString(),
  };

  const name = deviceName ?? credential.deviceName!;
  saveCredential(name, credential, true);

  // Update state
  saveState({
    sessionId: session.id,
    controllerToken: credential.controllerToken,
    edgeId: session.edge_id,
    credentialId: credential.credentialId,
    pairUrl: session.pair_url,
    status: "claimed",
  });

  return { session: claimed, credential };
}

export function formatPairingStatus(cred: DeviceCredential | null): string {
  if (!cred) return "Not paired. Run 'zhihand pair' to connect a device.";
  return [
    `Paired to: ${cred.deviceName ?? "unknown device"}`,
    `Endpoint: ${cred.endpoint}`,
    `Credential: ${cred.credentialId}`,
    `Paired at: ${cred.pairedAt ?? "unknown"}`,
  ].join("\n");
}

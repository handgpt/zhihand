import QRCode from "qrcode";
import type { DeviceRecord, DevicePlatform, UserRecord } from "./config.ts";
import {
  addUser,
  addDeviceToUser,
  ensureZhiHandDir,
  saveState,
  resolveDefaultEndpoint,
  getUserRecord,
  cleanupLegacyConfig,
} from "./config.ts";
import { fetchDeviceProfileOnce, extractStatic } from "./device.ts";
import { fetchUserCredentials, type CredentialResponse } from "./ws.ts";

export interface PairingSession {
  session_id: string;
  pair_url: string;
  qr_payload: string;
  expires_at: string;
}

export interface CreateUserResponse {
  user_id: string;
  controller_token: string;
  label: string;
  created_at: string;
}

// ── Server API helpers ─────────────────────────────────────

/**
 * Create a new user on the server.
 * POST /v1/users { label } → { user_id, controller_token, label, created_at }
 */
export async function createUser(
  endpoint: string,
  label: string,
): Promise<CreateUserResponse> {
  const response = await fetch(`${endpoint}/v1/users`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ label }),
  });
  if (!response.ok) {
    throw new Error(`Create user failed: ${response.status} ${await response.text()}`);
  }
  return (await response.json()) as CreateUserResponse;
}

/**
 * Create a pairing session for a user.
 * POST /v1/users/{id}/pairing/sessions { edge_id, ttl_seconds } → PairingSession
 */
export async function createPairingSession(
  endpoint: string,
  userId: string,
  controllerToken: string,
  edgeId: string,
  ttlSeconds: number = 300,
): Promise<PairingSession> {
  const response = await fetch(`${endpoint}/v1/users/${encodeURIComponent(userId)}/pairing/sessions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${controllerToken}`,
    },
    body: JSON.stringify({
      edge_id: edgeId,
      ttl_seconds: ttlSeconds,
      requested_scopes: ["observe", "session.control", "screen.read", "screen.capture", "ble.control"],
    }),
  });
  if (!response.ok) {
    throw new Error(`Create pairing session failed: ${response.status}`);
  }
  const payload = (await response.json()) as PairingSession;
  return payload;
}

/**
 * Register a plugin (edge). Kept for backward compat with edge registration.
 */
export async function registerPlugin(
  endpoint: string,
  options: {
    stableIdentity: string;
    displayName?: string;
    adapterKind?: string;
  },
): Promise<{ edge_id: string }> {
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
  const payload = (await response.json()) as { plugin: { edge_id: string } };
  return { edge_id: payload.plugin.edge_id };
}

/**
 * Poll pairing session until claimed or expired.
 */
export async function waitForPairingClaim(
  endpoint: string,
  userId: string,
  controllerToken: string,
  sessionId: string,
  timeoutMs: number = 600_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const response = await fetch(
      `${endpoint}/v1/users/${encodeURIComponent(userId)}/pairing/sessions/${encodeURIComponent(sessionId)}`,
      { headers: { "Authorization": `Bearer ${controllerToken}` } },
    );
    if (!response.ok) {
      throw new Error(`Get pairing session failed: ${response.status}`);
    }
    const session = (await response.json()) as { status: string };
    if (session.status === "claimed") {
      return;
    }
    if (session.status === "expired") {
      throw new Error("Pairing session expired.");
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error("Pairing timeout.");
}

export async function renderPairingQRCode(url: string): Promise<string> {
  return QRCode.toString(url, { type: "utf8", margin: 2 });
}

// ── Pairing flows ──────────────────────────────────────────

/**
 * New user pairing: create user → create pairing session → wait → fetch credentials → save config.
 */
export async function executePairingNewUser(
  preferredLabel?: string,
): Promise<{ userRecord: UserRecord; deviceRecord: DeviceRecord }> {
  const endpoint = resolveDefaultEndpoint();
  const label = preferredLabel ?? `User-${Date.now().toString(36)}`;

  // 1. Create user
  const userResp = await createUser(endpoint, label);

  // Clean up v2/legacy config after network call succeeds (avoids data loss on failure)
  cleanupLegacyConfig();
  const userId = userResp.user_id;
  const controllerToken = userResp.controller_token;

  // 2. Register plugin (get edge_id)
  const stableIdentity = `mcp-${Date.now().toString(36)}`;
  const plugin = await registerPlugin(endpoint, { stableIdentity });
  const edgeId = plugin.edge_id;

  // 3. Create pairing session
  const session = await createPairingSession(endpoint, userId, controllerToken, edgeId, 300);

  saveState({
    sessionId: session.session_id,
    userId,
    controllerToken,
    edgeId,
    pairUrl: session.pair_url,
    status: "pending",
    expiresAt: session.expires_at,
  });

  // 4. Show QR + wait
  const qr = await renderPairingQRCode(session.pair_url);
  console.log(qr);
  console.log(`Open this URL on your phone to pair:\n  ${session.pair_url}\n`);
  console.log(`Expires at: ${session.expires_at}`);
  console.log("Waiting for phone to scan...\n");

  await waitForPairingClaim(endpoint, userId, controllerToken, session.session_id);

  // 5. Fetch credentials to get device info
  const creds = await fetchUserCredentials(endpoint, userId, controllerToken);
  const cred = creds[0]; // Just-paired device should be the first/only
  if (!cred) throw new Error("Pairing claimed but no credentials found");

  // 6. Try to get label/platform from profile
  let deviceLabel = cred.label ?? "";
  let platform: DevicePlatform = (cred.platform as DevicePlatform) ?? "unknown";
  try {
    const runtimeCfg = {
      controlPlaneEndpoint: endpoint,
      credentialId: cred.credential_id,
      controllerToken,
      timeoutMs: 10_000,
    };
    const fetched = await fetchDeviceProfileOnce(runtimeCfg);
    if (fetched) {
      const st = extractStatic(fetched.rawAttrs);
      if (!deviceLabel || deviceLabel === cred.credential_id) {
        deviceLabel = st.model && st.model !== "unknown" ? st.model : "";
      }
      if (st.platform === "ios" || st.platform === "android") platform = st.platform;
    }
  } catch {
    // fall through
  }
  if (!deviceLabel) deviceLabel = `device-${Date.now().toString(36)}`;

  const now = new Date().toISOString();
  const deviceRecord: DeviceRecord = {
    credential_id: cred.credential_id,
    label: deviceLabel,
    platform,
    paired_at: cred.paired_at ?? now,
    last_seen_at: now,
  };

  const userRecord: UserRecord = {
    user_id: userId,
    controller_token: controllerToken,
    label,
    created_at: userResp.created_at ?? now,
    devices: [deviceRecord],
  };

  addUser(userRecord);
  ensureZhiHandDir();

  saveState({
    sessionId: session.session_id,
    userId,
    controllerToken,
    edgeId,
    credentialId: cred.credential_id,
    pairUrl: session.pair_url,
    status: "claimed",
  });

  return { userRecord, deviceRecord };
}

/**
 * Add device to existing user: create pairing session → wait → fetch new credential → save.
 */
export async function executePairingAddDevice(
  userId: string,
  preferredLabel?: string,
): Promise<DeviceRecord> {
  const endpoint = resolveDefaultEndpoint();
  const user = getUserRecord(userId);
  if (!user) throw new Error(`User '${userId}' not found in config`);

  const controllerToken = user.controller_token;

  // Register plugin (get edge_id)
  const stableIdentity = `mcp-${Date.now().toString(36)}`;
  const plugin = await registerPlugin(endpoint, { stableIdentity });
  const edgeId = plugin.edge_id;

  // Get existing credential IDs before pairing
  const existingCreds = await fetchUserCredentials(endpoint, userId, controllerToken);
  const existingIds = new Set(existingCreds.map((c) => c.credential_id));

  // Create pairing session
  const session = await createPairingSession(endpoint, userId, controllerToken, edgeId, 300);

  const qr = await renderPairingQRCode(session.pair_url);
  console.log(qr);
  console.log(`Open this URL on your phone to pair:\n  ${session.pair_url}\n`);
  console.log(`Expires at: ${session.expires_at}`);
  console.log("Waiting for phone to scan...\n");

  await waitForPairingClaim(endpoint, userId, controllerToken, session.session_id);

  // Fetch credentials and find the new one
  const updatedCreds = await fetchUserCredentials(endpoint, userId, controllerToken);
  const newCred = updatedCreds.find((c) => !existingIds.has(c.credential_id));
  if (!newCred) throw new Error("Pairing claimed but no new credential found");

  // Try to get label/platform
  let deviceLabel = preferredLabel ?? newCred.label ?? "";
  let platform: DevicePlatform = (newCred.platform as DevicePlatform) ?? "unknown";
  try {
    const runtimeCfg = {
      controlPlaneEndpoint: endpoint,
      credentialId: newCred.credential_id,
      controllerToken,
      timeoutMs: 10_000,
    };
    const fetched = await fetchDeviceProfileOnce(runtimeCfg);
    if (fetched) {
      const st = extractStatic(fetched.rawAttrs);
      if (!deviceLabel || deviceLabel === newCred.credential_id) {
        deviceLabel = st.model && st.model !== "unknown" ? st.model : "";
      }
      if (st.platform === "ios" || st.platform === "android") platform = st.platform;
    }
  } catch {
    // fall through
  }
  if (!deviceLabel) deviceLabel = `device-${Date.now().toString(36)}`;

  const now = new Date().toISOString();
  const deviceRecord: DeviceRecord = {
    credential_id: newCred.credential_id,
    label: deviceLabel,
    platform,
    paired_at: newCred.paired_at ?? now,
    last_seen_at: now,
  };

  addDeviceToUser(userId, deviceRecord);

  return deviceRecord;
}

/**
 * Legacy: format pairing status (kept for backward compat).
 */
export function formatPairingStatus(userId: string | null): string {
  if (!userId) return "Not paired. Run 'zhihand pair' to connect a device.";
  const user = getUserRecord(userId);
  if (!user) return "Not paired. Run 'zhihand pair' to connect a device.";
  const lines = [
    `User: ${user.label} (${user.user_id})`,
    `Devices: ${user.devices.length}`,
    ...user.devices.map(
      (d) => `  - ${d.credential_id} (${d.label}, ${d.platform})`,
    ),
  ];
  return lines.join("\n");
}

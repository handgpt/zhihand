import type { DeviceCredential } from "./config.ts";
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
/**
 * Register this MCP instance as a plugin with the server.
 * Server requires a registered plugin (edge_id) before pairing can begin.
 * Idempotent — re-registering with the same stable_identity returns the existing plugin.
 */
export declare function registerPlugin(endpoint: string, options: {
    stableIdentity: string;
    displayName?: string;
    adapterKind?: string;
}): Promise<PluginRecord>;
export declare function createPairingSession(endpoint: string, options: CreatePairingOptions): Promise<PairingSession>;
export declare function getPairingSession(endpoint: string, sessionId: string): Promise<PairingSession>;
export declare function waitForPairingClaim(endpoint: string, sessionId: string, timeoutMs?: number): Promise<PairingSession>;
export declare function renderPairingQRCode(url: string): Promise<string>;
export declare function executePairing(endpoint: string, edgeId: string, deviceName?: string): Promise<{
    session: PairingSession;
    credential: DeviceCredential;
}>;
export declare function formatPairingStatus(cred: DeviceCredential | null): string;

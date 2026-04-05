import type { DeviceRecord } from "./config.ts";
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
export declare function registerPlugin(endpoint: string, options: {
    stableIdentity: string;
    displayName?: string;
    adapterKind?: string;
}): Promise<PluginRecord>;
export declare function createPairingSession(endpoint: string, options: CreatePairingOptions): Promise<PairingSession>;
export declare function getPairingSession(endpoint: string, sessionId: string): Promise<PairingSession>;
export declare function waitForPairingClaim(endpoint: string, sessionId: string, timeoutMs?: number): Promise<PairingSession>;
export declare function renderPairingQRCode(url: string): Promise<string>;
/**
 * Drive the full interactive pairing flow. Saves a new device record into the
 * v2 config on success. Label defaults to the device model (fetched post-claim)
 * and falls back to the supplied preferredLabel or timestamp.
 */
export declare function executePairing(endpoint: string, edgeId: string, preferredLabel?: string): Promise<{
    session: PairingSession;
    record: DeviceRecord;
}>;
export declare function formatPairingStatus(record: DeviceRecord | null): string;

import type { DeviceRecord, UserRecord } from "./config.ts";
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
/**
 * Create a new user on the server.
 * POST /v1/users { label } → { user_id, controller_token, label, created_at }
 */
export declare function createUser(endpoint: string, label: string): Promise<CreateUserResponse>;
/**
 * Create a pairing session for a user.
 * POST /v1/users/{id}/pairing/sessions { edge_id, ttl_seconds } → PairingSession
 */
export declare function createPairingSession(endpoint: string, userId: string, controllerToken: string, edgeId: string, ttlSeconds?: number): Promise<PairingSession>;
/**
 * Register a plugin (edge). Kept for backward compat with edge registration.
 */
export declare function registerPlugin(endpoint: string, options: {
    stableIdentity: string;
    displayName?: string;
    adapterKind?: string;
}): Promise<{
    edge_id: string;
}>;
/**
 * Poll pairing session until claimed or expired.
 */
export declare function waitForPairingClaim(endpoint: string, userId: string, controllerToken: string, sessionId: string, timeoutMs?: number): Promise<void>;
export declare function renderPairingQRCode(url: string): Promise<string>;
/**
 * New user pairing: create user → create pairing session → wait → fetch credentials → save config.
 */
export declare function executePairingNewUser(preferredLabel?: string): Promise<{
    userRecord: UserRecord;
    deviceRecord: DeviceRecord;
}>;
/**
 * Add device to existing user: create pairing session → wait → fetch new credential → save.
 */
export declare function executePairingAddDevice(userId: string, preferredLabel?: string): Promise<DeviceRecord>;
/**
 * Legacy: format pairing status (kept for backward compat).
 */
export declare function formatPairingStatus(userId: string | null): string;

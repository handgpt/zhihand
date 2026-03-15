# Phase 1 Production Design

## Decision

Phase 1 uses:

- a host adapter as the passive endpoint, starting with OpenClaw
- iOS / Android app as the active connector
- Cloudflare Tunnel for reachability
- QR code for pairing bootstrap and trust establishment

Phase 1 does **not** use a self-hosted relay on the live data path.

## What This Is, Precisely

This is **not** "no backend forever".

It is:

- no self-hosted relay in the live control path
- adapter-local service exposed through Cloudflare Tunnel
- an optional deployment-specific control plane outside this public repo for provisioning, cleanup, revocation, and fleet management

## Core Roles

### Host Adapter

- owns the tunnel-facing local HTTPS / WSS service
- owns pairing state
- owns per-app credentials
- owns permission grants
- owns session lease enforcement

The first production adapter is OpenClaw. Future adapters may target other host environments such as Codex and Claude Code.

### Mobile App

- scans QR
- confirms adapter identity
- initiates the connection
- stores its long-term credential in Keychain / Android Keystore
- executes BLE-related actions only when the relevant hardware capability is available

### Cloudflare

- provides public reachability to the adapter through Tunnel
- is not the trust source for app pairing
- is not the long-term application credential store

### Deployment Control Plane

- may own pairing session issuance
- may own opaque `edge-id` allocation
- may own tunnel and hostname lifecycle
- may own app / adapter roster and revoke flows
- is not required to sit on the default live command path in Phase 1

### BLE Hardware

- is a separate trust domain from adapter pairing
- must not inherit high-risk permissions automatically

## Domain Plan

- `zhihand.com`
  brand and top-level entry
- `pair.zhihand.com`
  Universal Link / App Link QR entry domain
- `<edge-id>.edge.zhihand.com`
  per-adapter production endpoint
- `api.zhihand.com`
  reserved for future provisioning and lifecycle management
- `relay.zhihand.com`
  reserved for future relay mode

## Endpoint Naming

- `edge-id` must be opaque and random
- do not use usernames, emails, device names, or hardware serials
- recommended shape: 10 to 12 chars of Crockford Base32

Example:

`k7m2p4t9xq.edge.zhihand.com`

## Production Constraints

- no long-lived Cloudflare service token inside the mobile app
- no adapter-initiated connection into the app
- no assumption that the mobile app can behave as a background server
- no assumption that BLE control is always available
- no user-defined public hostnames

## Why A Deployment Control Plane May Exist

A deployment control plane may still be useful even when the live control session is app-to-adapter via Cloudflare Tunnel.

It can handle:

- pairing session issuance
- endpoint naming
- tunnel provisioning and cleanup
- roster metadata
- credential revocation

Those capabilities are intentionally treated as deployment-specific and are therefore outside this public repo.

## QR Format

QR must encode an HTTPS link, not raw JSON and not only a custom scheme.

Recommended shape:

`https://pair.zhihand.com/p/1?d=<base64url_payload>`

The payload should include:

- `v`
- `mode = cf_tunnel`
- `edge_host`
- `pair_session_id`
- `pair_token`
- `exp`
- `adapter_name`
- `adapter_pubkey`
- `adapter_fingerprint`
- `requested_scopes`
- `protocol_min`
- `protocol_max`

## Pairing Flow

1. Adapter confirms Tunnel is online.
2. Adapter opens a short pairing window.
3. Adapter creates:
   - a single-use pairing token
   - a short-lived pairing keypair
   - an expiry timestamp
   - a pairing session ID
   - optionally by requesting a signed pairing session from a deployment-specific control plane
4. Adapter renders the QR code.
5. App scans QR and shows:
   - adapter name
   - fingerprint suffix
   - requested permissions
   - expiry countdown
6. User taps connect in the app.
7. App initiates HTTPS to the adapter endpoint.
8. App sends:
   - app instance ID
   - app public key
   - pairing token
   - platform and app version
9. Adapter proves possession of the pairing private key through challenge-response.
10. Adapter shows a second confirmation step on the adapter side:
    - explicit confirm button, or
    - a short verification code shown on both sides
11. On approval, adapter issues a long-lived per-app credential.
12. App stores that credential securely.
13. Adapter invalidates the QR token immediately.

## Long-Term Credential Model

Use asymmetric credentials.

- app generates its own long-term keypair
- private key stays in Keychain / Android Keystore
- adapter stores app public key, metadata, scopes, and last seen time
- future reconnect uses signed nonce challenge, not the original QR token

## Permission Model

Permissions are split into distinct scopes:

- `observe`
- `session.control`
- `ble.control`
- `device.manage`
- `device.ota`

Default first-pair grant:

- `observe`
- `session.control`

Extra confirmation required:

- `ble.control`
- `device.manage`
- `device.ota`

## Transport Model

Phase 1 transport is:

- HTTPS for pairing and management
- WSS for the live control session

Do not make raw gRPC the mobile-facing transport in Phase 1. Keep the wire model aligned with the shared action model so it can map cleanly into the shared protocol later.

## Session Lease Rules

- WebSocket heartbeat every 15 seconds
- session considered stale after 45 seconds without heartbeat
- adapter must actively reap ghost sessions
- only one foreground control session per app instance

## Mobile Platform Rules

### iOS

- do not depend on long-lived background sockets
- interactive control assumes app foreground
- QR should support Universal Links
- request Camera permission only at scan time
- request Bluetooth permission only when BLE features are entered

### Android

- app is still the active connector
- interactive control assumes foreground for best reliability
- QR should support App Links
- Bluetooth permissions are requested lazily when hardware features are used

## BLE Rules

- app pairing to the adapter does not automatically authorize hardware control
- app is the default BLE owner in Phase 1
- adapter sends intent-level commands, not a permanent remote HID stream
- OTA, reset, reprovision, and destructive commands always require step-up confirmation

## Cloudflare Rules

- one named tunnel per adapter instance
- one public hostname per adapter instance
- no `trycloudflare.com` in production
- tunnel provisioning may start manual, but may later be owned by deployment-specific infrastructure

## Explicit Non-Goals For Phase 1

- no direct adapter-to-app P2P across NAT
- no Cloudflare WARP as the default onboarding path
- no mDNS / same-LAN fast path in the first production slice
- no self-hosted relay on the live path

## Deferred But Planned

### Phase 1.5

- optional same-LAN optimization
- optional local path upgrade after tunnel-based trust is established

### Phase 2

- minimal deployment control plane on `api.zhihand.com`
- automated tunnel provisioning
- DNS lifecycle cleanup
- revocation and fleet roster
- hostname rotation

### Phase 3

- relay mode on `relay.zhihand.com`
- richer policy and audit
- multi-adapter and multi-device orchestration

## Gemini Checkpoint Outcome

Gemini agreed that the Cloudflare-first direction is pragmatic for Phase 1, while highlighting four production issues that are adopted here:

- random opaque endpoint naming
- explicit adapter-side pairing confirmation
- session lease cleanup to avoid ghost sessions
- early reservation of a minimal control-plane for lifecycle management

Gemini also suggested same-LAN fallback. That is deliberately deferred, not rejected forever. The reason is simplicity: the first production slice should avoid local-network discovery, extra mobile permissions, and dual-path debugging until the tunnel path is stable.

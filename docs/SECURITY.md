# ZhiHand Security Notes

This document describes the current security boundary. It is not a substitute for a full product security review.

## Authentication

### Bearer Token Auth

All API and WebSocket connections use `Authorization: Bearer <controller_token>`:
- HTTP REST endpoints: Bearer header on every request
- WebSocket: Bearer header in HTTP upgrade handshake
- Per-user tokens: each user has an independent `controller_token`

### Token Storage

Credentials are stored at `~/.zhihand/config.json` with file mode `0600`. Config writes use atomic tmp+rename to prevent corruption from concurrent access.

### Token Rotation

`zhihand rotate <user_id>` rotates the controller token for a user. The old token is immediately invalidated server-side.

## Transport Security

- All connections to the control plane use HTTPS/WSS
- Local daemon listens on `localhost:18686` only (not exposed to network)
- WebSocket connections include a 35s watchdog; stale connections are dropped
- HTTP upgrade rejections (401/403) stop retry after 10 consecutive failures

## Config Schema v3

Multi-user config groups devices under users. Each user's `controller_token` is independent, limiting blast radius if a single token is compromised.

## Device Runtime

### ZhiHand Device firmware

- BLE bonding with `ESP_LE_AUTH_BOND`
- Currently uses `ESP_IO_CAP_NONE` (Just Works pairing, no MITM protection)
- Command execution and OTA protected behind lease mechanism

## Current Gaps

- Firmware pairing model is weaker than ideal for a high-assurance control device
- End-to-end security review across mobile, control plane, and firmware is still pending
- No certificate pinning on client-side HTTPS connections

## Publishing Rule

Public documentation and configs must never include real tokens, operator credentials, private hostnames, or production certificates.

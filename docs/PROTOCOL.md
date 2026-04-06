# ZhiHand Protocol

## Source of Truth

The authoritative protocol definition is `proto/zhihand/control/v1/control.proto`.

## Protocol Goals

One versioned control contract for all participants:

- Control plane (`zhihandd`, hosted server)
- Host adapters (OpenClaw, MCP stdio)
- Mobile apps (iOS, Android)
- Device runtimes (BLE firmware)

## Design Rules

- **Versioned Namespaces**: Wire contracts live in explicit versioned namespaces (`v1`)
- **Backward Compatibility**: Changes preserve compatibility unless there is a deliberate version boundary
- **Explicit Capabilities**: Participants describe what they support
- **Structured Errors**: Failures are machine-readable and categorized
- **Streaming**: Long-running actions use streaming semantics (WebSocket)

## Current Transport

### WebSocket (Primary)

Per-user WebSocket connections to the control plane:
- `ws(s)://endpoint/v1/users/{id}/ws?topic=...` — device registry events
- `ws(s)://endpoint/v1/credentials/{id}/ws?topic=prompts` — prompt listener

Auth via HTTP upgrade `Authorization: Bearer` header. Protocol-level ping/pong for keepalive.

### HTTP REST

- `POST /v1/users` — create user
- `POST /v1/users/{id}/pairing/sessions` — create pairing session
- `GET /v1/users/{id}/credentials` — list credentials with online status
- `PATCH /v1/credentials/{id}` — rename device
- `DELETE /v1/credentials/{id}` — remove credential
- `POST /v1/commands` — enqueue command
- `GET /v1/commands/{id}` — poll command ACK
- `GET /v1/screenshots/{id}` — fetch screenshot (binary JPEG)

All authenticated endpoints use `Authorization: Bearer <controller_token>`.

## Ownership

The public core repo owns protocol definition and versioning policy. Runtime implementations consume the protocol and should not fork it privately.

## Non-Goals

- Embedding platform-specific UI semantics into the wire contract
- Duplicating the protocol in each runtime
- Letting host adapters define competing message shapes

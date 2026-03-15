# zhihandd

`zhihandd` is the core control service for the ZhiHand workspace.

This directory now contains a minimal runnable implementation. It establishes:

- the service entrypoint
- environment-driven configuration
- an HTTP control surface that mirrors the shared protocol model
- an in-memory event bus for action, capability, and heartbeat events

## Goals

- Host the shared control API defined in `proto/zhihand/control/v1/control.proto`
- Coordinate actions from host adapters, mobile apps, web runtimes, and device runtimes
- Keep the server-side control semantics centralized in the core repo

## Current Shape

- `cmd/zhihandd/main.go`
  Process entrypoint
- `internal/config/config.go`
  Environment-driven configuration
- `internal/control/service.go`
  In-memory control model and event bus
- `internal/http/routes.go`
  HTTP routes for control, capability, and event APIs

## HTTP Endpoints

- `GET /healthz`
- `GET /v1/server/info`
- `GET /v1/capabilities`
- `POST /v1/actions/execute`
- `GET /v1/events`
- `GET /v1/events/stream`

## Next Steps

1. Add generated proto bindings and a real gRPC listener.
2. Replace the in-memory execution path with routed handlers.
3. Persist action and event history behind an interface.
4. Add integration tests against at least one host adapter.

# zhihandd

`zhihandd` is the core control service for the ZhiHand workspace.

This directory now contains a minimal runnable implementation. It establishes:

- the service entrypoint
- environment-driven configuration
- an authenticated HTTP control surface that mirrors the shared protocol model
- an in-memory bounded event bus for action, capability, and heartbeat events

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

## Implemented Today

- `GET /healthz`
- `GET /v1/server/info`
- `GET /v1/capabilities`
- `POST /v1/actions/execute`
- `GET /v1/events`
- `GET /v1/events/stream`
- Optional bearer-token protection through `ZHIHAND_AUTH_TOKEN`
- Bounded event retention through `ZHIHAND_EVENT_LIMIT`

## Not Implemented Yet

- A public gRPC listener
- Persistent storage for actions and events
- Routed execution backends beyond the in-memory reference path

## Notes

- The HTTP JSON surface uses `control.proto` enum names as strings, matching protobuf JSON conventions.
- `zhihandd` is a public reference service, not the private hosted production control plane.

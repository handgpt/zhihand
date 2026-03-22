# ZhiHand Compatibility Matrix

Current core release: `0.9.14`

This matrix exists so the public protocol repo, the OpenClaw adapter, and downstream runtimes do not drift silently.

## Public Core

| Component | Current track | Notes |
| --- | --- | --- |
| `control.proto` | `zhihand.control.v1` | Source of truth for action names and event semantics |
| `zhihandd` | `0.9.x` | Reference HTTP/SSE service |
| OpenClaw adapter | `0.9.x` | Published as `@zhihand/openclaw` |

## Device Runtime

| Component | Current track | Notes |
| --- | --- | --- |
| ZhiHand Device firmware | `1.1.x` | BLE HID + lease + OTA runtime |

## Compatibility Rules

### OpenClaw adapter ↔ `zhihandd`

- must use the same action and status names as `control.proto`
- should stay on the same public core minor line (`0.9.x`)

### Public core ↔ private hosted control plane

- private control planes may expose extra deployment DTOs
- shared semantics must still be rooted in `control.proto`

### Device firmware ↔ mobile runtimes

- lease protocol version is independent from `control.proto`
- firmware OTA and command changes should be treated as device-runtime compatibility work, not public control-protocol changes

## Planned Follow-Up

- generated proto bindings checked into the public repo
- an expanded matrix that includes Android and iOS runtime tracks once those repos fully converge on the shared control-plane model

# ZhiHand Protocol

## Source Of Truth

The authoritative protocol definition is:

`proto/zhihand/control/v1/control.proto`

This document explains how that protocol should be treated across the workspace.

## Protocol Goals

The protocol exists to provide one versioned control contract for:

- `zhihandd`
- host adapters
- mobile apps
- device runtimes
- web runtimes

The protocol should be stable enough for independent repository evolution while still allowing controlled iteration.

## Design Rules

### Versioned Namespaces

All wire contracts should live in explicit versioned namespaces such as `v1`.

### Backward Compatibility By Default

Changes should preserve compatibility unless there is a deliberate version boundary.

### Explicit Capability Boundaries

The protocol should let participants describe what they support rather than rely on undocumented assumptions.

### Structured Errors

Failures should be machine-readable and categorized so runtimes can react predictably.

### Streaming Where It Matters

Long-running actions, lifecycle updates, and event-style communication should use streaming semantics when appropriate instead of fake polling embedded into unrelated calls.

## Recommended Protocol Layers

The protocol should conceptually separate:

- Control requests and commands
- Capability discovery
- Action lifecycle updates
- State snapshots or queries
- Error and compatibility reporting

These layers do not need to be separate files, but they should remain conceptually distinct.

## Ownership

The public core repo owns protocol definition and versioning policy. Runtime implementations consume the protocol and should not fork it privately.

If a platform needs a new field, message, or lifecycle event, the change should be introduced in the core repo first and then adopted downstream.

## Integration Expectations

Every runtime should be able to answer the following:

- Which protocol version does it implement?
- Which capabilities does it support?
- Which actions can it initiate?
- Which actions can it observe or execute?
- How does it report failure?

If these answers are unclear, the integration is not mature enough.

## Validation Strategy

Near-term protocol work should include:

1. Keeping the proto file reviewed and versioned.
2. Generating client or server bindings only from the shared definition.
3. Testing compatibility between core and at least one external runtime.
4. Documenting any intentionally unsupported behavior.

Near-term implementation note:

- `zhihandd` currently exposes a reference HTTP/JSON + SSE surface.
- That surface uses the protobuf enum names as JSON strings, matching protobuf JSON conventions.
- A first-class gRPC listener is still planned, not shipped in this repository yet.

## Current Transport Shim

The current Phase 1 implementation uses a deployment-level HTTP/JSON + SSE shim
for pairing, uploads, acknowledgements, device profiles, and server-initiated
event streams.

That shim is an implementation bridge, not the long-term public protocol.

Rules:

- `control.proto` remains the public contract source of truth
- deployment-specific HTTP payloads are transitional DTOs
- host adapters and mobile runtimes should not treat private JSON structs as
  the final stable cross-repo contract
- new shared semantics should land in the public protocol before they become
  permanent cross-repo assumptions

The public reference service follows the same rule:

- enum-shaped values in HTTP JSON should use the `control.proto` enum names
- the reference service must not invent a second incompatible action taxonomy

## Non-Goals

- Embedding platform-specific UI semantics into the wire contract
- Duplicating the protocol in each runtime implementation
- Letting host adapters define competing message shapes

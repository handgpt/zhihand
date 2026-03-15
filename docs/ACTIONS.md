# ZhiHand Action Model

## Purpose

An action is the shared unit of intent inside ZhiHand. Actions make it possible for different runtimes to request, observe, and reason about behavior using one model.

This document defines the role of actions at the architecture level. The exact wire representation belongs in `control.proto`.

## Why Actions Exist

The workspace now contains separate repositories for iOS, Android, Web, hardware, and core services. Without a shared action model, each runtime would encode intent differently and the system would drift quickly.

Actions give the system a stable vocabulary for:

- Commanding behavior
- Reporting state transitions
- Describing execution lifecycle
- Returning success, failure, or partial results
- Coordinating plugin and service integrations

## Action Principles

### Intent Over UI

Actions should describe what the system wants to do, not how a specific client screen happens to express it.

### Shared Semantics

If multiple runtimes need to express the same behavior, they should reuse the same action concept.

### Observable Lifecycle

An action should support clear lifecycle transitions such as requested, accepted, started, progressed, completed, failed, or cancelled when those states matter.

### Capability-Aware

Not every runtime supports every action. The system should allow capabilities to be negotiated instead of assuming universal support.

## Recommended Categories

The exact taxonomy can evolve, but the action model should be organized around stable categories such as:

- Session actions
- Device actions
- Input actions
- Tool or integration actions
- State query actions
- Control and lifecycle actions

Each category should map cleanly into versioned protocol messages rather than ad hoc client-side payloads.

## Action Lifecycle

At minimum, the system should be able to represent:

1. Action requested
2. Action accepted or rejected
3. Action execution progress
4. Action completed successfully
5. Action failed
6. Action cancelled

If a runtime cannot expose the full lifecycle, the gap should be explicit.

## Action Identity

Every meaningful action should have:

- A stable action type
- A unique request or correlation identifier
- A clear initiator or source when relevant
- Enough metadata to trace outcomes across runtimes

## Error Model

Action failures should distinguish at least:

- Validation failure
- Unsupported capability
- Permission or trust failure
- Execution failure
- Timeout or transport failure
- Cancellation

The protocol should make these classes inspectable instead of collapsing them into generic strings.

## Cross-Repo Rule

The following integration categories should all align to the same action model:

- the public core
- host adapters
- mobile apps
- device runtimes
- web runtimes

If an implementation needs a new action, the shared model should be updated here first and then reflected in the protocol.

## Source Of Truth

This document explains the model. The canonical wire-level representation remains:

`proto/zhihand/control/v1/control.proto`

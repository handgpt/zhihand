# Runtime Surfaces

This public document describes the runtime categories that consume the ZhiHand shared model.

It intentionally does not list private repositories by name.

## Core Rule

`zhihand` defines the shared protocol and integration contract. Runtime implementations consume that contract and should not fork it privately.

## Runtime Categories

### Host Adapters

Examples include:

- OpenClaw
- Codex
- Claude Code

Host adapters translate host-specific events, tools, and session models into the shared ZhiHand action model.

### Mobile Apps

Mobile apps consume the public contract and expose user-facing experiences on mobile platforms.

### Device Runtimes

Device runtimes implement hardware- or firmware-facing behavior while staying aligned with the shared control model.

### Web Runtimes

Web runtimes provide browser-facing surfaces where the shared model makes sense.

## Integration Contract For Every Runtime

Every runtime category is expected to align with:

- the protocol defined in `control.proto`
- the shared action model
- the compatibility and capability rules defined in the public core

## What Runtimes Should Not Duplicate

- private forks of the proto contract
- divergent action names for the same intent
- undocumented lifecycle rules
- runtime-specific reinterpretation of shared errors

## Notes On Public Scope

This file describes public runtime categories, not private repository names or product-specific deployment layouts.

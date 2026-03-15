# ZhiHand

`ZhiHand` is the public core repository for the ZhiHand project.

It owns the shared protocol, action model, architecture notes, reference service skeletons, and host-adapter reference code that can be used by multiple host environments.

This repository intentionally does **not** enumerate private implementation repositories by name.

## Public Scope

This repository exists to define and stabilize the public shared layer:

- protocol contracts
- action semantics
- integration boundaries
- host-adapter model
- reference service behavior

Examples of host environments that may integrate with this shared model include:

- OpenClaw
- Codex
- Claude Code
- other host runtimes with plugin or tool-adapter support

## Repository Layout

```text
zhihand/
  docs/
  proto/
  services/
  packages/
    host-adapters/
```

## What Lives In This Repo

- `docs/`
  Public architecture, protocol, repository, and runtime-boundary documentation.
- `proto/`
  Versioned protocol definitions. `proto/zhihand/control/v1/control.proto` is the source of truth for the public control contract.
- `services/`
  Reference service skeletons, including `zhihandd`.
- `packages/`
  Public host-adapter packages and reference adapter code.

## Responsibilities

This repository should answer the following questions:

- What is the public architecture of ZhiHand?
- What messages and actions exist in the shared control model?
- What does `zhihandd` represent as a reference control-plane service?
- How should host adapters map host-specific events into the shared model?
- How should mobile apps, device runtimes, and web runtimes integrate without redefining protocol semantics?

This repository should not become a catch-all for private product infrastructure or platform-specific application code.

## Current Phase

The project is currently focused on Phase 1:

1. Stabilize `control.proto`.
2. Implement the first usable `zhihandd` control surface.
3. Establish the public host-adapter boundary, starting with OpenClaw.
4. Keep the shared model extensible for additional host environments such as Codex and Claude Code.
5. Keep the public core free of private deployment-specific assumptions.

## Document Map

- [ROADMAP.md](./ROADMAP.md)
- [README.zh-CN.md](./README.zh-CN.md)
- [ARCHITECTURE.md](./docs/ARCHITECTURE.md)
- [ACTIONS.md](./docs/ACTIONS.md)
- [CONFIGURATION.md](./docs/CONFIGURATION.md)
- [CONFIGURATION.zh-CN.md](./docs/CONFIGURATION.zh-CN.md)
- [PROTOCOL.md](./docs/PROTOCOL.md)
- [REPOSITORY.md](./docs/REPOSITORY.md)
- [CLIENT_REPOS.md](./docs/CLIENT_REPOS.md)
- [PRODUCTION.md](./PRODUCTION.md)
- [PRODUCTION.zh-CN.md](./PRODUCTION.zh-CN.md)

## Working Rules

- `control.proto` is the public protocol source of truth.
- Shared semantics belong here.
- Secret-bearing, deployment-specific, or product-private infrastructure does not belong here.
- Platform-native implementation should live outside this public core unless it is a public reference adapter.
- Public documentation in this repository must remain safe to publish.

## Near-Term Deliverables

- A documented and versioned public control API
- A runnable `zhihandd` skeleton with clear service boundaries
- A first public host-adapter path through OpenClaw
- A repository and architecture model that stays extensible for future adapters such as Codex and Claude Code

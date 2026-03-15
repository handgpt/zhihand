# ZhiHand Architecture

## Overview

ZhiHand is a public shared layer built around a protocol-first control model.

The public core should stay neutral across host environments and runtime implementations. It should define one shared model that can be consumed by:

- host adapters
- mobile apps
- device runtimes
- web runtimes
- deployment-specific services outside the public repo

## Core Components

### 1. Shared Protocol

`proto/zhihand/control/v1/control.proto` defines the versioned public control interface. It is the source of truth for message shapes, service methods, and compatibility boundaries.

### 2. `zhihandd`

`zhihandd` is the reference control-plane service in the public core. Its responsibilities include:

- accepting control requests
- applying routing, validation, capability, and lifecycle rules
- coordinating action execution
- demonstrating the intended server-side model for the public protocol

### 3. Host Adapters

Host adapters translate host-specific events and APIs into the ZhiHand control model.

The initial public adapter path starts with OpenClaw. Future host adapters may target environments such as Codex and Claude Code.

Host adapters should stay thin. They adapt to the shared model instead of defining a second model.

### 4. Runtime Categories

The shared model should remain usable across these runtime categories:

- host adapters
- mobile apps
- device runtimes
- web runtimes

The public repo intentionally does not enumerate private implementation repositories by name.

## Architectural Boundaries

### What Belongs In `zhihand`

- shared protocol definitions
- core action semantics
- public architecture documentation
- public service contracts
- host-adapter boundaries
- compatibility rules

### What Does Not Belong In `zhihand`

- private deployment infrastructure names or secrets
- platform-native application implementation
- hardware-specific production firmware implementation
- secret-bearing control-plane integrations

## Interaction Model

At a high level, the public model should look like this:

```text
Host Adapter / Mobile App / Device Runtime / Web Runtime
                         |
                         v
                      zhihandd
                         |
                         v
            Shared action and protocol model
```

Deployment-specific services may sit beside this model, but they should consume the public contract rather than redefine it.

## Design Principles

### Protocol-First

Shared behavior starts in the protocol, not in a host-specific or app-specific implementation.

### Versioned Contracts

Breaking changes must be introduced intentionally and documented.

### Thin Adapters

Host adapters should map host behavior into the shared model without creating parallel semantics.

### Public / Private Separation

The public repo should define portable contracts. Deployment-specific services and private product infrastructure should stay outside the public repo.

## Near-Term Architecture Targets

- one coherent public control surface
- one canonical action taxonomy
- one capability and lifecycle model
- a first end-to-end host-adapter integration

## Risks

- protocol drift between public contracts and private implementations
- leaking host-specific assumptions into shared semantics
- creating a second undocumented protocol surface in deployment-specific infrastructure
- turning the public core into a mixed public/private catch-all

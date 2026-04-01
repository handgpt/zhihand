# ZhiHand Architecture

## Overview

ZhiHand is a public shared layer built around a protocol-first control model, now primarily delivered via the **Model Context Protocol (MCP)**.

The core of ZhiHand is the unified MCP Server (`@zhihand/mcp`), which centralizes business logic, tool definitions, and state management. This allows ZhiHand to be seamlessly integrated into any MCP-compatible AI agent or host environment.

## Core Components

### 1. Unified MCP Server (`@zhihand/mcp`)

The MCP Server is the primary implementation layer. It handles:
- **Tools**: Defines `zhihand_control`, `zhihand_screenshot`, `zhihand_pair`, etc.
- **Transports**: Supports both `stdio` (for local CLI tools) and `SSE/HTTP` (for remote or web-based tools).
- **State Management**: Manages pairing credentials, device profiles, and command queues.
- **CLI Interface**: Provides the `zhihand` command-line tool for setup, pairing, and service management.

### 2. Shared Protocol

`proto/zhihand/control/v1/control.proto` defines the versioned public control interface. It remains the source of truth for message shapes and service methods, consumed by the MCP Server and mobile apps.

### 3. `zhihandd` (Reference Service)

`zhihandd` continues to serve as the reference control-plane service, coordinating communication between the MCP Server (acting as a client to `zhihandd`) and the mobile apps.

### 4. Host Adapters (Thin Wrappers)

Host adapters are now thin wrappers around the MCP Server.
- **OpenClaw**: A plugin that calls the MCP Server.
- **Claude Code / Gemini CLI**: Direct integration via the MCP `stdio` transport.

## Interaction Model

The MCP-centric interaction model looks like this:

```text
      AI Agents (Claude Code, Gemini CLI, etc.)
                         |
                         v (MCP stdio/HTTP)
                @zhihand/mcp (Server)
                         |
                         v (ZhiHand Protocol)
                      zhihandd (Control Plane)
                         |
                         v (ZhiHand Protocol)
                    Mobile App (Eye/Hand)
```

## Design Principles

### MCP-First Integration

Integration should prioritize the Model Context Protocol to ensure compatibility with the broadest range of AI tools.

### Centralized Logic

Business logic resides in the MCP Server to keep host-specific adapters as thin as possible.

### Protocol-First

Shared behavior starts in the protocol (`control.proto`), ensuring consistency across all components.

## Implementation Status

### Implemented in this repository

- `control.proto`: Public protocol definition.
- `zhihandd`: Reference HTTP/SSE control surface.
- `@zhihand/mcp`: Unified MCP Server (Core logic, tools, CLI).
- OpenClaw: MCP-based host adapter.

### Planned, not yet shipped

- Native gRPC support in `zhihandd`.
- Enhanced automated update and rollback via `zhihand update`.
- Robust system service integration for persistent background MCP servers.

# ZhiHand Architecture

## Overview

ZhiHand is built around the **Model Context Protocol (MCP)**. The core is a unified MCP Server (`@zhihand/mcp`) that centralizes business logic, tool definitions, and state management.

## Core Components

### 1. Unified MCP Server (`@zhihand/mcp`)

The MCP Server is the primary implementation layer:

- **Tools**: `zhihand_control`, `zhihand_screenshot`, `zhihand_system`, `zhihand_list_devices`, `zhihand_pair`
- **Transports**: `stdio` (for AI CLI tools) and HTTP Streamable (daemon mode on `localhost:18686/mcp`)
- **State Management**: Multi-user config (schema v3), device registry with config hot-reload
- **Real-time Events**: Per-user WebSocket streams for device online/offline, profile updates, credential lifecycle, command ACKs
- **CLI Interface**: `zhihand` command for pairing, device management, backend switching

### 2. Multi-User Model

Devices are grouped under users. Each user has:
- A `usr_*` ID and `controller_token` (Bearer auth)
- One WebSocket stream for all device events
- Multiple devices (`crd_*` credentials)

Config schema v3 stores this in `~/.zhihand/config.json`.

### 3. Daemon

A persistent process bundles three subsystems:

| Subsystem | Purpose |
|---|---|
| MCP Server | HTTP Streamable transport — serves tool calls to AI agents |
| Relay | Brain heartbeat (30s), WebSocket prompt listener, CLI dispatch |
| Config API | IPC endpoint for `zhihand claude/gemini/codex` backend switching |

### 4. Host Adapters (Thin Wrappers)

- **OpenClaw**: Plugin that calls MCP core logic via the adapter
- **Claude Code / Gemini CLI / Codex CLI**: Direct integration via MCP stdio transport

## Interaction Model

```text
      AI Agents (Claude Code, Gemini CLI, Codex CLI)
                         |
                         v (MCP stdio/HTTP)
                @zhihand/mcp (Server + Daemon)
                         |
                         v (WebSocket + REST)
                   ZhiHand Server (Control Plane)
                         |
                         v
                    Mobile App (iOS/Android)
```

## Transport

- **WebSocket** (`ws` package): Per-user streams with Bearer auth via HTTP upgrade headers, protocol-level ping/pong, exponential backoff with jitter, 35s watchdog
- **HTTP REST**: Command enqueue, screenshot fetch, credential management, pairing
- **Polling fallback**: PromptListener falls back to HTTP polling when WebSocket disconnects

## Design Principles

- **MCP-First**: Integration prioritizes the Model Context Protocol
- **Centralized Logic**: Business logic in MCP Server, host adapters stay thin
- **Server-Authoritative**: Online detection via server events, no client-side heartbeat polling
- **Atomic Config**: Config writes use tmp+rename pattern to prevent corruption

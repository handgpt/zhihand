# ZhiHand Roadmap

This roadmap describes the public-core view of delivery.

## Phase 1: Shared Control Model (Completed)

Goal: make the shared control model executable and reusable across multiple host environments and runtime categories.

- `control.proto` is stable.
- `zhihandd` exposes a usable reference control surface.
- Initial OpenClaw integration established.

## Phase 2: MCP-First Architecture (Current)

Goal: pivot to the **Model Context Protocol (MCP)** as the primary integration layer to support modern AI agents (Claude Code, Gemini CLI, etc.).

Primary outcomes:
- Unified `@zhihand/mcp` package.
- Support for `stdio` and `SSE/HTTP` transports.
- Comprehensive toolset (`zhihand_control`, `zhihand_screenshot`, `zhihand_pair`).
- Thin-wrapper host adapters for OpenClaw and others.

Key work:
1. Implement core MCP server logic.
2. Build interactive `zhihand` CLI for setup and management.
3. Establish robust pairing and credential persistence.
4. Integrate with Claude Code and Gemini CLI.

## Phase 3: Runtime & Reliability

Goal: ensure stability across different environments and improve user experience.

Primary outcomes:
- One-click setup/install via CLI.
- System service support for background MCP servers.
- Automated update and rollback mechanisms.
- Improved observability and error recovery.

## Phase 4: Productization

Goal: move from a prototype to a stable public core suitable for long-term evolution.

Primary outcomes:
- Stable release process for the public core.
- Clear compatibility policy across protocol and adapters.
- Migration guidance for older integrations.

## Current Priority Order

1. **MCP Core Tools**: Finalize `control`, `screenshot`, and `pair` tools.
2. **CLI Experience**: `zhihand setup` and `zhihand status`.
3. **Integration Documentation**: Guide for Claude Code and Gemini CLI.
4. **Service Reliability**: Background process management and logs.

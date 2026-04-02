# ZhiHand

ZhiHand lets AI agents (like Claude Code, Gemini CLI, Codex CLI, and OpenClaw) see your phone and help operate it through the ZhiHand Device.

Current core version: `0.16.0`

## Architecture

ZhiHand is built on the **Model Context Protocol (MCP)**. The core is a **persistent daemon** that bundles the MCP Server (HTTP Streamable transport), a Relay (heartbeat, prompt listener, CLI dispatch), and a Config API for backend switching.

```text
                    ┌──────────────────────────────────────┐
                    │           @zhihand/mcp daemon         │
                    │                                      │
                    │  MCP Server (localhost:18686/mcp)     │
                    │  Relay (heartbeat, prompt, dispatch)  │
                    │  Config API (backend IPC)             │
                    └──────────┬───────────────────────┬───┘
                               │                       │
                    ┌──────────▼──────┐     ┌──────────▼──────┐
                    │  HTTP Streamable │     │  OpenClaw Plugin │
                    │  (AI agents)     │     │  (Thin Wrapper)  │
                    └──────────┬──────┘     └──────────┬──────┘
                               │                       │
              ┌────────────────┼───────────────────────┼──────┐
              │                │                       │      │
        Claude Code      Gemini CLI             OpenClaw    Codex CLI
```

## Quick Start

### Prerequisites

- **Node.js >= 22**
- A **ZhiHand mobile app** (Android or iOS) installed on your phone

### 1. Install

```bash
npm install -g @zhihand/mcp
```

### 2. Setup and Pair

```bash
zhihand setup
```

This interactive command will:

1. Register as a plugin with the ZhiHand server
2. Display a QR code in your terminal
3. Wait for you to scan it with the ZhiHand mobile app
4. Save credentials locally to `~/.zhihand/credentials.json`
5. Detect installed AI tools on your machine
6. Auto-select the best tool and configure MCP automatically
7. Start the daemon (MCP Server + Relay + Config API)

No manual MCP configuration needed. To switch backend later:

```bash
zhihand claude             # Switch to Claude Code
zhihand gemini             # Switch to Gemini CLI
zhihand codex              # Switch to Codex CLI
```

### 3. Start Using

Once configured, your AI agent can control your phone directly:

```
> Take a screenshot of my phone
> Tap on the Settings icon at (0.5, 0.3)
> Type "hello world" into the text field
> Scroll down 5 steps
> Swipe from bottom to top
```

## Available Tools

The MCP Server provides three tools to AI agents:

### `zhihand_control`

Control the phone with these actions:

| Action | Parameters | Description |
|---|---|---|
| `click` | `xRatio`, `yRatio` | Tap at position (normalized 0–1) |
| `doubleclick` | `xRatio`, `yRatio` | Double-tap |
| `rightclick` | `xRatio`, `yRatio` | Right-click / long press |
| `middleclick` | `xRatio`, `yRatio` | Middle-click |
| `type` | `text` | Type text into focused field |
| `swipe` | `startXRatio`, `startYRatio`, `endXRatio`, `endYRatio` | Swipe gesture |
| `scroll` | `xRatio`, `yRatio`, `direction`, `amount` | Scroll (up/down/left/right) |
| `keycombo` | `keys` | Key combination (`"ctrl+c"`, `"alt+tab"`) |
| `clipboard` | `clipboardAction`, `text` | Get or set clipboard |
| `wait` | `durationMs` | Wait locally (default 1000ms, max 10000ms) |
| `screenshot` | — | Capture screen immediately |

All coordinates are **normalized ratios** from `0.0` (top-left) to `1.0` (bottom-right).

Every action returns a text summary and a screenshot.

### `zhihand_screenshot`

Capture the current screen without any action. No parameters.

### `zhihand_pair`

Pair with a new phone. Set `forceNew: true` to re-pair.

## CLI Commands

```
zhihand setup              Interactive setup: pair + detect tools + auto-select + configure MCP + start daemon
zhihand start              Start daemon (MCP Server + Relay + Config API)
zhihand start -d           Start daemon in background (detached)
zhihand stop               Stop the running daemon
zhihand status             Show daemon status, pairing info, device, and active backend

zhihand pair               Pair with a phone device
zhihand detect             Detect installed CLI tools
zhihand serve              Start MCP Server (stdio mode, backward compatible)

zhihand claude             Switch backend to Claude Code (sends IPC to daemon, auto-configures MCP)
zhihand codex              Switch backend to Codex CLI (sends IPC to daemon, auto-configures MCP)
zhihand gemini             Switch backend to Gemini CLI (sends IPC to daemon, auto-configures MCP)

zhihand --help             Show help
```

| Option | Description |
|---|---|
| `--device <name>` | Use a specific paired device |
| `ZHIHAND_DEVICE` | Environment variable, same as `--device` |
| `ZHIHAND_CLI` | Override CLI tool detection |

## Android & iOS Apps

1. Download and install the ZhiHand app for **Android** or **iOS**.
2. Tap **Scan** and scan the QR code from your AI agent.
3. Connect your **ZhiHand Device**.
4. Turn on **Eye** (screen sharing) when you want the agent to see your screen.

## How It Works

```
AI Agent ←HTTP Streamable→ Daemon (localhost:18686/mcp) ←HTTPS/SSE→ ZhiHand Server ←→ Mobile App
```

**Agent-initiated flow** (AI agent calls tools):

1. AI agent calls a tool (e.g. `zhihand_control` with `action: "click"`)
2. MCP Server translates to a device command and enqueues it via the ZhiHand API
3. Mobile app picks up the command, executes it, and sends an ACK
4. MCP Server receives the ACK via SSE (or polling fallback)
5. MCP Server fetches a screenshot (raw JPEG) and returns it to the agent

**Phone-initiated flow** (user speaks/types on phone):

1. Phone sends prompt to ZhiHand Server
2. Daemon receives prompt via SSE
3. Daemon spawns the active CLI tool (e.g. `claude`, `codex`, `gemini`) with the prompt
4. CLI tool executes, result is sent back to the phone

The daemon sends a **brain heartbeat** every 30 seconds, keeping the phone Brain indicator green to show an AI backend is connected.

## What This Repository Contains

This repository is the public core for ZhiHand:

- `packages/mcp/` — MCP Server and OpenClaw adapter ([README](./packages/mcp/README.md))
- `packages/host-adapters/openclaw/` — Legacy OpenClaw host adapter
- Public docs, protocol, and action model
- Reference service boundaries

It does not include private deployment secrets or private product infrastructure.

## Where To Read Next

- [@zhihand/mcp README](./packages/mcp/README.md) — Detailed MCP Server documentation
- [Distribution](./docs/DISTRIBUTION.md) — How users install and start using ZhiHand
- [Configuration](./docs/CONFIGURATION.md) — What users need, and what advanced self-hosters can override
- [Updates](./docs/UPDATES.md) — How app and device updates are detected and delivered
- [Android app](https://github.com/handgpt/zhihand-android) — Mobile UI, permissions, pairing
- [ZhiHand server](https://github.com/handgpt/zhihand-server) — Hosted control-plane
- [README.zh-CN.md](./README.zh-CN.md) — 中文版

## For Developers

- [ARCHITECTURE.md](./docs/ARCHITECTURE.md)
- [ACTIONS.md](./docs/ACTIONS.md)
- [PROTOCOL.md](./docs/PROTOCOL.md)
- [COMPATIBILITY.md](./docs/COMPATIBILITY.md)
- [SECURITY.md](./docs/SECURITY.md)
- [REPOSITORY.md](./docs/REPOSITORY.md)
- [CLIENT_REPOS.md](./docs/CLIENT_REPOS.md)
- [ROADMAP.md](./ROADMAP.md)

The public reference service in this repo currently ships:

- HTTP JSON + SSE
- optional bearer-token auth
- bounded in-memory event retention

It does not yet ship a real gRPC listener.

## Publishing Rule

Public documentation in this repository must stay safe to publish:

- no real tokens
- no private hostnames
- no operator credentials
- no deployment-only notes

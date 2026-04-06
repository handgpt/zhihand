# ZhiHand

ZhiHand lets AI agents (Claude Code, Gemini CLI, Codex CLI, OpenClaw) see and control your phone.

Version: `0.32.1`

## Architecture

ZhiHand is built on the **Model Context Protocol (MCP)**. The core is a persistent daemon (`@zhihand/mcp`) that bundles the MCP Server, a Relay (heartbeat, prompt listener, CLI dispatch), and a Config API for backend switching.

Multi-user support: each user gets a dedicated WebSocket stream. Devices are grouped under users with separate controller tokens.

```text
                    +--------------------------------------+
                    |         @zhihand/mcp daemon           |
                    |                                      |
                    |  MCP Server (localhost:18686/mcp)     |
                    |  Relay (heartbeat, prompt, dispatch)  |
                    |  Config API (backend IPC)             |
                    +----------+-----------------------+---+
                               |                       |
                    +----------v------+     +----------v------+
                    | HTTP Streamable  |     | OpenClaw Plugin  |
                    | (AI agents)      |     | (Thin Wrapper)   |
                    +----------+------+     +----------+------+
                               |                       |
              +----------------+-----+-----------------+------+
              |                |     |                 |      |
        Claude Code      Gemini CLI  |           OpenClaw   Codex CLI
                                     |
                              +------v-------+
                              | ZhiHand      |
                              | Server (WS)  |
                              +------+-------+
                                     |
                              +------v-------+
                              | Mobile App   |
                              | (iOS/Android)|
                              +--------------+
```

## Quick Start

### Prerequisites

- **Node.js >= 22**
- **ZhiHand mobile app** (Android or iOS)

### 1. Install

```bash
npm install -g @zhihand/mcp
```

### 2. Pair

```bash
zhihand pair
```

This will:

1. Create a new user on the ZhiHand server
2. Display a QR code in your terminal
3. Wait for you to scan it with the ZhiHand mobile app
4. Save credentials to `~/.zhihand/config.json`
5. Detect installed AI tools and auto-configure MCP

To add a device to an existing user:

```bash
zhihand pair <user_id>
```

### 3. Start the Daemon

```bash
zhihand start              # Foreground
zhihand start -d           # Background (logs to ~/.zhihand/daemon.log)
```

### 4. Start Using

Your AI agent can now control your phone:

```
> Take a screenshot of my phone
> Tap on the Settings icon
> Type "hello world" into the search box
> Scroll down to find the About section
```

## CLI Commands

```
zhihand pair [--label X]   Pair new user + first device + auto-configure MCP
zhihand pair <user_id>     Add device to existing user
zhihand list [<user_id>]   List users/devices with real-time online status
zhihand unpair <id>        Remove user (usr_*) or device (credential)
zhihand rename <cred> <n>  Rename a device (server-side + local)
zhihand export <user_id>   Export user credentials as JSON to stdout
zhihand import <file>      Import user credentials from JSON file
zhihand rotate <user_id>   Rotate controller token

zhihand start              Start daemon (MCP Server + Relay, foreground)
zhihand start -d           Start daemon in background
zhihand stop               Stop daemon
zhihand status             Show status (pairing, backend, brain)

zhihand claude             Switch backend to Claude Code
zhihand gemini             Switch backend to Gemini CLI
zhihand codex              Switch backend to Codex CLI

zhihand test [cred] [ids]  Run device tests
zhihand mcp                Start stdio MCP server (for AI host integration)
zhihand detect             Detect available CLI tools
```

### Options

| Option | Description |
|---|---|
| `--label <label>` | Label for new device (pair) |
| `--model, -m <name>` | Backend model alias (e.g. `flash`, `sonnet`, `opus`) |
| `--port <port>` | Override daemon port (default: 18686) |
| `-d, --detach` | Run daemon in background |
| `--debug` | Enable verbose debug logging |
| `--force` | Skip capability gates in test |

### Environment Variables

| Variable | Description |
|---|---|
| `ZHIHAND_DEVICE` | Default credential_id |
| `ZHIHAND_CLI` | Override CLI tool selection for mobile-initiated tasks |
| `ZHIHAND_MODEL` | Override model for all backends |
| `ZHIHAND_GEMINI_MODEL` | Override model for Gemini only |
| `ZHIHAND_CLAUDE_MODEL` | Override model for Claude only |
| `ZHIHAND_CODEX_MODEL` | Override model for Codex only |

## MCP Tools

### `zhihand_control`

The main phone control tool:

| Action | Parameters | Description |
|---|---|---|
| `click` | `xRatio`, `yRatio` | Tap at normalized coordinates [0,1] |
| `doubleclick` | `xRatio`, `yRatio` | Double-tap |
| `longclick` | `xRatio`, `yRatio`, `durationMs` | Long press (default 800ms) |
| `type` | `text` | Type text into the focused field |
| `swipe` | `startXRatio`, `startYRatio`, `endXRatio`, `endYRatio`, `durationMs` | Swipe gesture |
| `scroll` | `xRatio`, `yRatio`, `direction`, `amount` | Scroll up/down/left/right |
| `keycombo` | `keys` | Key combination (`"ctrl+c"`, `"alt+tab"`) |
| `back` | -- | System Back button |
| `home` | -- | System Home button |
| `enter` | -- | Press Enter key |
| `open_app` | `appPackage`, `bundleId`, `urlScheme`, `appName` | Open an application |
| `clipboard` | `clipboardAction`, `text` | Get or set clipboard |
| `wait` | `durationMs` | Wait locally (no server round-trip) |
| `screenshot` | -- | Capture screen immediately |

All coordinates are **normalized ratios** from `0.0` (top-left) to `1.0` (bottom-right). Every action returns a text summary and a screenshot.

### `zhihand_screenshot`

Capture the current screen without any action. No parameters.

### `zhihand_system`

System navigation and media controls: home, back, recents, notifications, quick settings, volume, brightness, rotation, DND, wifi, bluetooth, flashlight, airplane mode, split screen, pip, power menu, lock screen.

### `zhihand_list_devices`

List all paired devices with real-time status: online/offline, battery, platform, last active. In multi-user mode, labels are prefixed with `[userLabel]`.

### `zhihand_pair`

Pair with a phone device. Returns a QR code and pairing URL.

## How It Works

```
AI Agent <--HTTP Streamable--> Daemon (localhost:18686/mcp) <--WebSocket--> ZhiHand Server <--> Mobile App
```

**Agent-initiated flow** (tool calls):

1. AI agent calls a tool (e.g. `zhihand_control` with `action: "click"`)
2. MCP Server enqueues a device command via the ZhiHand API
3. Mobile app executes the command and sends an ACK
4. MCP Server receives the ACK via WebSocket (or polling fallback)
5. MCP Server fetches a screenshot and returns it to the agent

**Phone-initiated flow** (user speaks/types on phone):

1. Phone sends prompt to ZhiHand Server
2. Daemon receives prompt via WebSocket
3. Daemon spawns the active CLI tool (`claude`, `codex`, `gemini`) with the prompt
4. Result is sent back to the phone

The daemon sends a **brain heartbeat** every 30 seconds, keeping the phone Brain indicator green.

## Config Storage

```
~/.zhihand/
  config.json       User + device credentials (schema v3)
  backend.json      Active backend + model selection
  daemon.pid        Daemon PID file
  daemon.log        Daemon log output (background mode)
```

Config schema v3 groups devices under users:

```json
{
  "schema_version": 3,
  "users": {
    "usr_abc123": {
      "user_id": "usr_abc123",
      "controller_token": "tok_...",
      "label": "Personal",
      "devices": [
        {
          "credential_id": "crd_xyz",
          "label": "My iPhone",
          "platform": "ios",
          "paired_at": "2026-04-01T00:00:00.000Z",
          "last_seen_at": "2026-04-06T12:00:00.000Z"
        }
      ]
    }
  }
}
```

## Repository Structure

```
zhihand/
  packages/
    mcp/                  @zhihand/mcp — MCP Server, daemon, CLI
      bin/zhihand         CLI entry point
      src/
        index.ts          MCP Server (stdio transport)
        openclaw.adapter.ts  OpenClaw Plugin adapter
        core/
          config.ts       Config v3 management (~/.zhihand/)
          ws.ts           WebSocket client (ReconnectingWebSocket, UserEventWebSocket)
          registry.ts     Multi-user device registry with config hot-reload
          device.ts       Device profile, capabilities
          command.ts      Command creation, enqueue, ACK
          screenshot.ts   Binary screenshot fetch (JPEG)
          pair.ts         User creation + device pairing flow
          logger.ts       Unified logger (stderr in MCP mode)
        daemon/
          index.ts        Daemon: HTTP server + MCP + Relay + Config API
          heartbeat.ts    Brain heartbeat loop (30s)
          prompt-listener.ts  WebSocket + polling prompt listener
          dispatcher.ts   CLI dispatch (spawn + timeout + kill)
        tools/
          control.ts      zhihand_control handler
          system.ts       zhihand_system handler
          screenshot.ts   zhihand_screenshot handler
          pair.ts         zhihand_pair handler
          schemas.ts      Zod parameter schemas
        cli/
          detect.ts       CLI tool detection
          spawn.ts        CLI process spawning
          mcp-config.ts   MCP auto-configuration
    host-adapters/
      openclaw/           OpenClaw Plugin adapter (thin wrapper)
  services/
    zhihandd/             Reference control service (Go)
  docs/                   Protocol, architecture, security, actions
```

## Switching Backends

```bash
zhihand gemini                # Switch to Gemini CLI (model: flash)
zhihand claude                # Switch to Claude Code (model: sonnet)
zhihand codex                 # Switch to Codex CLI (model: gpt-5.4-mini)
zhihand gemini --model pro    # Use a custom model
```

When you switch:
- IPC message is sent to the running daemon
- MCP config is automatically added to the new backend
- MCP config is automatically removed from the previous backend
- Model selection is persisted to `~/.zhihand/backend.json`

## Android & iOS Apps

1. Download and install the ZhiHand app for **Android** or **iOS**
2. Tap **Scan** and scan the QR code from your terminal
3. Connect your **ZhiHand Device**
4. Turn on **Eye** (screen sharing) when you want the agent to see your screen

## For Developers

- [ARCHITECTURE.md](./docs/ARCHITECTURE.md) — System architecture, components, transport
- [CONFIGURATION.md](./docs/CONFIGURATION.md) — Setup guide for AI agents and OpenClaw
- [PROTOCOL.md](./docs/PROTOCOL.md) — Protocol design, WebSocket/REST endpoints
- [SECURITY.md](./docs/SECURITY.md) — Auth, transport security, current gaps
- [ACTIONS.md](./docs/ACTIONS.md) — Shared action model across runtimes

### Development

```bash
cd packages/mcp
npm install
npm run build         # Compile TypeScript
npm run dev           # Dev mode (--experimental-strip-types)
npm test              # Run tests
```

## Publishing Rule

Public documentation must stay safe to publish: no real tokens, no private hostnames, no operator credentials, no deployment-only notes.

## License

MIT

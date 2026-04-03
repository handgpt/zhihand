# @zhihand/mcp

ZhiHand MCP Server — let AI agents see and control your phone.

Version: `0.25.0`

## What is this?

`@zhihand/mcp` is the core integration layer for ZhiHand. It runs as a **persistent daemon** that exposes phone control tools to any compatible AI agent via [MCP (Model Context Protocol)](https://modelcontextprotocol.io/), including:

- **Claude Code**
- **Codex CLI**
- **Gemini CLI**
- **OpenClaw**

The daemon is a single persistent process that bundles three subsystems:

| Subsystem | Purpose |
|---|---|
| **MCP Server** | HTTP Streamable transport on `localhost:18686/mcp` — serves tool calls to AI agents |
| **Relay** | Brain heartbeat (30s), prompt listener (phone-initiated tasks), CLI dispatch |
| **Config API** | IPC endpoint for `zhihand gemini/claude/codex` backend switching |

Legacy entry points (backward compatible):

| Entry | Purpose |
|---|---|
| `zhihand serve` | MCP Server (stdio mode) — legacy, still works for direct CLI integration |
| `zhihand.openclaw` | OpenClaw Plugin entry — thin wrapper calling the same core |

## Requirements

- **Node.js >= 22**
- A **ZhiHand mobile app** (Android or iOS) installed on your phone

## Installation

```bash
npm install -g @zhihand/mcp
```

Or use directly with `npx`:

```bash
npx @zhihand/mcp serve
```

## Quick Start

### 1. Setup and pair

```bash
zhihand setup
```

This runs the full interactive setup:

1. Registers as a plugin with the ZhiHand server
2. Creates a pairing session and displays a QR code in the terminal
3. Waits for you to scan the QR code with the ZhiHand mobile app
4. Saves credentials to `~/.zhihand/credentials.json`
5. Detects installed CLI tools (Claude Code, Codex, Gemini CLI, OpenClaw)
6. Auto-selects the best available tool and configures MCP automatically
7. Starts the daemon (MCP Server + Relay + Config API)

No manual MCP configuration needed — `zhihand setup` handles everything.

### 2. Start the daemon

```bash
zhihand start              # Start daemon in foreground
zhihand start -d           # Start daemon in background (detached)
```

The daemon runs the MCP Server on `localhost:18686/mcp` (HTTP Streamable transport), maintains a brain heartbeat every 30 seconds (keeps the phone Brain indicator green), and listens for phone-initiated prompts.

When started with `-d`, daemon logs are written to `~/.zhihand/daemon.log`.

### 3. Start using it

Once configured, your AI agent can use ZhiHand tools directly. For example, in Claude Code:

```
> Take a screenshot of my phone
> Tap on the Settings icon
> Type "hello world" into the search box
> Scroll down to find the About section
```

## CLI Commands

```
zhihand setup              Interactive setup: pair + detect tools + auto-select + configure MCP + start daemon
zhihand start              Start daemon (MCP Server + Relay + Config API)
zhihand start -d           Start daemon in background (logs to ~/.zhihand/daemon.log)
zhihand start --debug      Start daemon with verbose debug logging
zhihand stop               Stop the running daemon
zhihand status             Show daemon status, pairing info, device, backend, and model

zhihand test               Test device connectivity (screenshot, click, swipe, home, back)
zhihand pair               Pair with a phone (QR code in terminal)
zhihand detect             List detected CLI tools and their login status
zhihand serve              Start MCP Server (stdio mode, backward compatible)
zhihand --help             Show help

zhihand gemini             Switch backend to Gemini CLI (default model: flash)
zhihand claude             Switch backend to Claude Code (default model: sonnet)
zhihand codex              Switch backend to Codex CLI (default model: gpt-5.4-mini)
zhihand gemini --model pro Switch backend with custom model
```

### Daemon Lifecycle

```bash
zhihand start              # Start daemon in foreground
zhihand start -d           # Start daemon in background
zhihand start --debug      # Start with verbose debug logging
zhihand stop               # Stop the daemon
zhihand status             # Check if daemon is running, show device & backend info
```

The daemon is a single persistent process that runs:
- **MCP Server** on `localhost:18686/mcp` (HTTP Streamable transport)
- **Relay**: brain heartbeat every 30s (keeps phone Brain indicator green), prompt listener (phone-initiated tasks dispatched to CLI), CLI dispatch
- **Config API**: IPC endpoint for backend switching

### Switching Backends

Use `zhihand claude`, `zhihand codex`, or `zhihand gemini` to switch the active backend:

```bash
zhihand gemini                # Switch to Gemini CLI (model: flash)
zhihand claude                # Switch to Claude Code (model: sonnet)
zhihand codex                 # Switch to Codex CLI (model: gpt-5.4-mini)
zhihand gemini --model pro    # Use a custom model
zhihand claude -m opus        # Short flag form
```

Each backend has a **default model alias** that resolves to the latest version:

| Backend | Default | Alias examples | Resolution |
|---------|---------|---------------|------------|
| Gemini CLI | `flash` | `flash`, `pro` | Gemini CLI resolves natively (e.g. flash → gemini-2.5-flash) |
| Claude Code | `sonnet` | `sonnet`, `opus`, `haiku` | Claude Code resolves natively (e.g. sonnet → claude-sonnet-4) |
| Codex CLI | `gpt-5.4-mini` | any full model name | Codex requires full model names |

Model resolution priority: `--model` flag > `ZHIHAND_MODEL` env > `ZHIHAND_<BACKEND>_MODEL` env > default.

When you switch:
- The command sends an **IPC message to the running daemon**
- MCP config is **automatically added** to the new backend
- MCP config is **automatically removed** from the previous backend
- The model selection is **persisted** to `~/.zhihand/backend.json`
- If the tool is not installed, an error is shown

### Options

| Option | Description |
|---|---|
| `--device <name>` | Use a specific paired device (if you have multiple) |
| `--model, -m <name>` | Set model alias (e.g. `flash`, `pro`, `sonnet`, `opus`, `gpt-5.4-mini`) |
| `--port <port>` | Override daemon port (default: 18686) |
| `-d, --detach` | Run daemon in background |
| `--debug` | Enable verbose debug logging (all API requests, CLI args, SSE events) |
| `-h, --help` | Show help |

### Environment Variables

| Variable | Description |
|---|---|
| `ZHIHAND_DEVICE` | Default device name (same as `--device`) |
| `ZHIHAND_CLI` | Override CLI tool selection for mobile-initiated tasks |
| `ZHIHAND_MODEL` | Override model for all backends |
| `ZHIHAND_GEMINI_MODEL` | Override model for Gemini only |
| `ZHIHAND_CLAUDE_MODEL` | Override model for Claude only |
| `ZHIHAND_CODEX_MODEL` | Override model for Codex only |

## MCP Tools

The server exposes three tools to AI agents:

### `zhihand_control`

The main phone control tool. Supports these actions:

| Action | Parameters | Description |
|---|---|---|
| `click` | `xRatio`, `yRatio` | Tap at normalized coordinates [0,1] |
| `doubleclick` | `xRatio`, `yRatio` | Double-tap |
| `longclick` | `xRatio`, `yRatio`, `durationMs` | Long press (default 800ms) |
| `rightclick` | `xRatio`, `yRatio` | Right-click (desktop/BLE HID) |
| `middleclick` | `xRatio`, `yRatio` | Middle-click (desktop/BLE HID) |
| `type` | `text` | Type text into the focused field |
| `swipe` | `startXRatio`, `startYRatio`, `endXRatio`, `endYRatio`, `durationMs` | Swipe gesture (default 300ms) |
| `scroll` | `xRatio`, `yRatio`, `direction`, `amount` | Scroll up/down/left/right |
| `keycombo` | `keys` | Key combination (e.g. `"ctrl+c"`, `"alt+tab"`) |
| `back` | — | Press system Back button |
| `home` | — | Press system Home button |
| `enter` | — | Press Enter key |
| `open_app` | `appPackage`, `bundleId`, `urlScheme`, `appName` | Open an application |
| `clipboard` | `clipboardAction` (`get`/`set`), `text` | Read or write clipboard |
| `wait` | `durationMs` | Wait (local sleep, no server round-trip) |
| `screenshot` | — | Capture screen immediately |

Coordinates use **normalized ratios** (0.0 to 1.0), where `(0, 0)` is the top-left corner and `(1, 1)` is the bottom-right. This works across any screen resolution.

Every action returns a text summary and a screenshot of the result.

### `zhihand_screenshot`

Capture the current phone screen without performing any action. Returns an image.

No parameters required.

### `zhihand_pair`

Pair with a phone device. Returns a QR code and pairing URL.

| Parameter | Type | Description |
|---|---|---|
| `forceNew` | `boolean` | Force new pairing even if already paired (default: `false`) |

## How It Works

```
AI Agent ←HTTP Streamable→ Daemon (localhost:18686/mcp)
                               │
                               ├── MCP Server ──→ ZhiHand Server ──→ Mobile App
                               │     (tool calls: control, screenshot, pair)
                               │
                               ├── Relay
                               │     ├── Brain heartbeat (30s) ──→ Server
                               │     ├── Prompt listener (SSE) ←── Server ←── Phone
                               │     └── CLI dispatch ──→ spawn claude/codex/gemini
                               │
                               └── Config API
                                     └── IPC from zhihand claude/codex/gemini
```

### Agent-initiated flow (tool calls)

1. AI agent calls a tool (e.g. `zhihand_control` with `action: "click"`)
2. MCP Server translates to a device command and enqueues it via the ZhiHand API
3. Mobile app picks up the command, executes it, and sends an ACK
4. MCP Server receives the ACK (via SSE or polling fallback)
5. MCP Server fetches a fresh screenshot and returns it to the AI agent

### Phone-initiated flow (prompt relay)

1. User speaks or types a prompt on the phone
2. Phone sends prompt to ZhiHand Server
3. Daemon receives prompt via SSE
4. Daemon spawns the active CLI tool (e.g. `claude`, `codex`, `gemini`) with the prompt
5. CLI tool executes, result is sent back to the phone

### Brain heartbeat

The daemon sends a heartbeat to the ZhiHand Server every 30 seconds. This keeps the **Brain indicator green** on the phone, showing the user that an AI backend is connected and ready.

Screenshots are transferred as raw JPEG binary and only base64-encoded at the LLM API boundary, minimizing bandwidth.

## Credential Storage

Pairing credentials are stored at:

```
~/.zhihand/
├── credentials.json    # Device credentials (credentialId, controllerToken, endpoint)
├── backend.json        # Active backend + model selection
├── daemon.pid          # Daemon PID file (for zhihand stop)
├── daemon.log          # Daemon log output (when started with -d)
└── state.json          # Current pairing session state
```

You can manage multiple devices. The `credentials.json` file stores a `default` device name and a `devices` map:

```json
{
  "default": "mcp-myhost",
  "devices": {
    "mcp-myhost": {
      "credentialId": "cred_abc123",
      "controllerToken": "tok_...",
      "endpoint": "https://api.zhihand.com",
      "deviceName": "mcp-myhost",
      "pairedAt": "2026-04-01T00:00:00.000Z"
    }
  }
}
```

## Architecture

```
packages/mcp/
├── bin/
│   ├── zhihand              # Main CLI entry (start/stop/status/setup/serve/pair/detect)
│   └── zhihand.openclaw     # OpenClaw plugin entry
├── src/
│   ├── index.ts             # MCP Server (stdio transport, legacy)
│   ├── openclaw.adapter.ts  # OpenClaw Plugin adapter (thin wrapper)
│   ├── core/
│   │   ├── config.ts        # Credential & config management (~/.zhihand/), default models
│   │   ├── resolve-path.ts  # Platform-aware executable path resolution (gemini/claude/codex)
│   │   ├── command.ts       # Command creation, enqueue, ACK formatting
│   │   ├── screenshot.ts    # Binary screenshot fetch (JPEG)
│   │   ├── sse.ts           # SSE client + hybrid ACK (SSE push + polling fallback)
│   │   └── pair.ts          # Plugin registration + device pairing flow
│   ├── daemon/
│   │   ├── index.ts         # Daemon entry: HTTP server + MCP + Relay + Config API
│   │   ├── heartbeat.ts     # Brain heartbeat loop (30s interval, 5s retry)
│   │   ├── prompt-listener.ts # SSE + polling prompt listener with dedup
│   │   └── dispatcher.ts    # Async CLI dispatch (spawn + timeout + two-stage kill)
│   ├── tools/
│   │   ├── schemas.ts       # Zod parameter schemas
│   │   ├── control.ts       # zhihand_control handler
│   │   ├── screenshot.ts    # zhihand_screenshot handler
│   │   └── pair.ts          # zhihand_pair handler
│   └── cli/
│       ├── detect.ts        # CLI tool detection (Claude Code, Codex, Gemini, OpenClaw)
│       ├── spawn.ts         # CLI process spawning (for mobile-initiated tasks)
│       ├── mcp-config.ts    # MCP auto-configuration (add/remove per backend)
│       └── openclaw.ts      # OpenClaw auto-detect & plugin install
├── dist/                    # Compiled JavaScript (shipped in npm package)
├── package.json
└── tsconfig.json
```

## Development

```bash
# Install dependencies
npm install

# Build (compiles TypeScript to dist/)
npm run build

# Run in development mode (uses --experimental-strip-types)
npm run dev

# Run tests
npm test
```

## License

MIT

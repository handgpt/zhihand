# @zhihand/mcp

ZhiHand MCP Server — let AI agents see and control your phone.

Version: `0.12.1`

## What is this?

`@zhihand/mcp` is the core integration layer for ZhiHand. It provides an [MCP (Model Context Protocol)](https://modelcontextprotocol.io/) server that exposes phone control tools to any compatible AI agent, including:

- **Claude Code**
- **Codex CLI**
- **Gemini CLI**
- **OpenClaw**

One npm package, two entry points:

| Entry | Purpose |
|---|---|
| `zhihand serve` | MCP Server (stdio) — used by Claude Code, Codex, Gemini CLI |
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

### 1. Pair your phone

```bash
zhihand setup
```

This runs the full interactive setup:

1. Registers as a plugin with the ZhiHand server
2. Creates a pairing session and displays a QR code in the terminal
3. Waits for you to scan the QR code with the ZhiHand mobile app
4. Saves credentials to `~/.zhihand/credentials.json`
5. Detects installed CLI tools (Claude Code, Codex, Gemini CLI, OpenClaw)
6. Prints the MCP configuration snippet for your tools

### 2. Configure your AI tool

Add the ZhiHand MCP server to your tool's configuration:

**Claude Code** — Add to `.mcp.json` in your project root, or run:

```bash
claude mcp add zhihand -- zhihand serve
```

Or manually create/edit `.mcp.json`:

```json
{
  "mcpServers": {
    "zhihand": {
      "command": "zhihand",
      "args": ["serve"]
    }
  }
}
```

**Codex CLI** — Add to your MCP config:

```json
{
  "mcpServers": {
    "zhihand": {
      "command": "zhihand",
      "args": ["serve"]
    }
  }
}
```

**Gemini CLI** — Add to `~/.gemini/settings.json`:

```json
{
  "mcpServers": {
    "zhihand": {
      "command": "zhihand",
      "args": ["serve"]
    }
  }
}
```

**OpenClaw** — Install the plugin directly:

```bash
openclaw plugins install @zhihand/mcp
```

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
zhihand serve              Start MCP Server (stdio mode, called by AI tools)
zhihand setup              Interactive setup: pair + detect tools + print config
zhihand pair               Pair with a phone (QR code in terminal)
zhihand status             Show current pairing status and device info
zhihand detect             List detected CLI tools and their login status
zhihand --help             Show help
```

### Options

| Option | Description |
|---|---|
| `--device <name>` | Use a specific paired device (if you have multiple) |
| `-h, --help` | Show help |

### Environment Variables

| Variable | Description |
|---|---|
| `ZHIHAND_DEVICE` | Default device name (same as `--device`) |
| `ZHIHAND_CLI` | Override CLI tool selection for mobile-initiated tasks |

## MCP Tools

The server exposes three tools to AI agents:

### `zhihand_control`

The main phone control tool. Supports these actions:

| Action | Parameters | Description |
|---|---|---|
| `click` | `xRatio`, `yRatio` | Tap at normalized coordinates [0,1] |
| `doubleclick` | `xRatio`, `yRatio` | Double-tap |
| `rightclick` | `xRatio`, `yRatio` | Right-click (long press) |
| `middleclick` | `xRatio`, `yRatio` | Middle-click |
| `type` | `text` | Type text into the focused field |
| `swipe` | `startXRatio`, `startYRatio`, `endXRatio`, `endYRatio` | Swipe gesture |
| `scroll` | `xRatio`, `yRatio`, `direction`, `amount` | Scroll up/down/left/right |
| `keycombo` | `keys` | Key combination (e.g. `"ctrl+c"`, `"alt+tab"`) |
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
AI Agent ←stdio→ zhihand serve (MCP Server)
                       │
                       ├── POST /v1/plugins           Register plugin
                       ├── POST /v1/pairing/sessions   Create pairing
                       ├── POST /v1/credentials/{id}/commands   Send command
                       ├── GET  /v1/credentials/{id}/commands/{cid}   Poll ACK
                       ├── SSE  /v1/credentials/{id}/events?topic=commands   Real-time ACK
                       └── GET  /v1/credentials/{id}/screen   Fetch screenshot (JPEG)
                       │
                  ZhiHand Server
                       │
                  ZhiHand Mobile App
```

1. AI agent calls a tool (e.g. `zhihand_control` with `action: "click"`)
2. MCP Server translates to a device command and enqueues it via the ZhiHand API
3. Mobile app picks up the command, executes it, and sends an ACK
4. MCP Server receives the ACK (via SSE or polling fallback)
5. MCP Server fetches a fresh screenshot and returns it to the AI agent

Screenshots are transferred as raw JPEG binary and only base64-encoded at the LLM API boundary, minimizing bandwidth.

## Credential Storage

Pairing credentials are stored at:

```
~/.zhihand/
├── credentials.json    # Device credentials (credentialId, controllerToken, endpoint)
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
│   ├── zhihand              # Main CLI entry (serve/setup/pair/status/detect)
│   └── zhihand.openclaw     # OpenClaw plugin entry
├── src/
│   ├── index.ts             # MCP Server (stdio transport)
│   ├── openclaw.adapter.ts  # OpenClaw Plugin adapter (thin wrapper)
│   ├── core/
│   │   ├── config.ts        # Credential & config management (~/.zhihand/)
│   │   ├── command.ts       # Command creation, enqueue, ACK formatting
│   │   ├── screenshot.ts    # Binary screenshot fetch (JPEG)
│   │   ├── sse.ts           # SSE client + hybrid ACK (SSE push + polling fallback)
│   │   └── pair.ts          # Plugin registration + device pairing flow
│   ├── tools/
│   │   ├── schemas.ts       # Zod parameter schemas
│   │   ├── control.ts       # zhihand_control handler
│   │   ├── screenshot.ts    # zhihand_screenshot handler
│   │   └── pair.ts          # zhihand_pair handler
│   └── cli/
│       ├── detect.ts        # CLI tool detection (Claude Code, Codex, Gemini, OpenClaw)
│       ├── spawn.ts         # CLI process spawning (for mobile-initiated tasks)
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

# Configuration

This page explains how to configure ZhiHand for AI agents and OpenClaw.

## AI Agents (MCP)

### 1. Install

```bash
npm install -g @zhihand/mcp
```

### 2. Pair

```bash
zhihand pair
```

Follow the prompts: scan the QR code with the ZhiHand mobile app. Credentials are saved to `~/.zhihand/config.json`.

To add a device to an existing user:

```bash
zhihand pair <user_id>
```

### 3. Start the Daemon

```bash
zhihand start              # Foreground
zhihand start -d           # Background (logs to ~/.zhihand/daemon.log)
```

The daemon runs the MCP Server on `localhost:18686/mcp`, maintains a brain heartbeat, and listens for phone-initiated prompts via WebSocket.

### 4. Agent Configuration

`zhihand pair` auto-configures MCP for the detected AI tool. Manual configuration:

#### Claude Code

Add to `~/.claude/settings.json`:

```json
{
  "mcpServers": {
    "zhihand": {
      "command": "zhihand",
      "args": ["mcp"]
    }
  }
}
```

#### Gemini CLI

Add to `~/.gemini/settings.json`:

```json
{
  "mcpServers": {
    "zhihand": {
      "command": "zhihand",
      "args": ["mcp"]
    }
  }
}
```

#### Codex CLI

Add to `~/.codex/config.json`:

```json
{
  "mcpServers": {
    "zhihand": {
      "command": "zhihand",
      "args": ["mcp"]
    }
  }
}
```

### 5. Backend Switching

```bash
zhihand claude             # Switch to Claude Code (model: sonnet)
zhihand gemini             # Switch to Gemini CLI (model: flash)
zhihand codex              # Switch to Codex CLI (model: gpt-5.4-mini)
zhihand gemini --model pro # Custom model
```

Switching sends IPC to the daemon, auto-adds MCP config to the new backend, and removes it from the old one. Model is persisted to `~/.zhihand/backend.json`.

### 6. Device Management

```bash
zhihand list [<user_id>]   # List users/devices with online status
zhihand unpair <id>        # Remove user (usr_*) or device (crd_*)
zhihand rename <cred> <n>  # Rename device (server-side + local)
zhihand export <user_id>   # Export credentials as JSON
zhihand import <file>      # Import credentials from JSON
zhihand rotate <user_id>   # Rotate controller token
```

## OpenClaw Users

### 1. Install

```bash
openclaw plugins install @zhihand/openclaw
```

### 2. Trust and Configure

```bash
openclaw config set plugins.allow '["openclaw"]' --strict-json
openclaw config set tools.allow '["openclaw"]' --strict-json
```

### 3. Gateway Token

```bash
openclaw doctor --generate-gateway-token
openclaw config set gateway.http.endpoints.responses.enabled true --strict-json
openclaw config set plugins.entries.openclaw.config.gatewayAuthToken '"your-token"' --strict-json
```

### 4. Pair

```text
/zhihand pair
```

## Mobile Apps

1. **Scan**: Pair with host agent via QR code
2. **Connect**: Connect to ZhiHand Device (BLE)
3. **Eye**: Enable screen sharing

Advanced: override control plane endpoint in app settings (default: `https://api.zhihand.com`).

## Config Files

```
~/.zhihand/
  config.json       User + device credentials (schema v3)
  backend.json      Active backend + model selection
  daemon.pid        Daemon PID file
  daemon.log        Daemon log (background mode)
```

## Environment Variables

| Variable | Description |
|---|---|
| `ZHIHAND_DEVICE` | Default credential_id |
| `ZHIHAND_CLI` | Override CLI tool for mobile prompts |
| `ZHIHAND_MODEL` | Override model for all backends |
| `ZHIHAND_GEMINI_MODEL` | Override model for Gemini |
| `ZHIHAND_CLAUDE_MODEL` | Override model for Claude |
| `ZHIHAND_CODEX_MODEL` | Override model for Codex |

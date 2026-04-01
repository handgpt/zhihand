# Configuration

This page explains how to configure ZhiHand, focusing on the **Model Context Protocol (MCP)** for AI agents and legacy OpenClaw setups.

## AI Agents (MCP)

Most users should use the unified MCP Server. This allows AI agents like **Claude Code**, **Gemini CLI**, and others to directly control your phone.

### 1. Installation

Install the `@zhihand/mcp` package globally:

```bash
npm install -g @zhihand/mcp
```

This installs the `zhihand` command-line tool.

### 2. Interactive Setup

Run the setup command to configure your credentials and pair with your Android or iOS device:

```bash
zhihand setup
```

Follow the prompts to scan the QR code and authorize the connection.

### 3. Agent Configuration

Once paired, you can add ZhiHand to your favorite AI agent.

#### Claude Code

Claude Code can automatically detect the MCP server if you add it to your configuration. Or run it directly:

```bash
# Example manual start if needed
claude --mcp "zhihand serve"
```

#### Gemini CLI

Add the following to your Gemini CLI configuration (usually in your `~/.geminirc` or similar):

```json
{
  "mcp": {
    "zhihand": {
      "command": "zhihand",
      "args": ["serve"]
    }
  }
}
```

### 4. CLI Subcommands and Modes

The `zhihand` command provides several utilities to manage the MCP server and its lifecycle.

#### `zhihand serve` (Primary Entry Point)

This is the command that AI agents call to start the ZhiHand logic.

- **stdio mode** (Default):
  ```bash
  zhihand serve
  ```
  This mode is used when the AI agent (e.g., Claude Code, Gemini CLI) spawns ZhiHand as a sub-process. It communicates over standard input/output.
- **HTTP/SSE mode**:
  ```bash
  zhihand serve --http
  ```
  This starts a standalone web server that can be used by remote agents or web-based tools. It remains running until manually stopped.

#### `zhihand service` (Background Management)

If you want ZhiHand to run as a persistent background daemon (e.g., automatically starting on boot), use the service commands:

- `zhihand service install`: Registers ZhiHand as a system service (e.g., using systemd on Linux or launchd on macOS).
- `zhihand service uninstall`: Removes the background service.
- `zhihand service status`: Checks if the background daemon is currently running.
- `zhihand service logs`: Views real-time logs from the background process.

#### Additional Utilities

- `zhihand pair`: Only executes device pairing (useful if you don't need the full setup).
- `zhihand status`: Shows current pairing state, device info, and service health.
- `zhihand update`: Interactive update manager for the `@zhihand/mcp` package.

## OpenClaw Users

OpenClaw users can use the dedicated plugin, which acts as a wrapper for the MCP logic.

### 1. Installation

```bash
openclaw plugins install @zhihand/openclaw
```

### 2. Trust and Configuration

Enable the plugin and its tools:

```bash
openclaw config set plugins.allow '["openclaw"]' --strict-json
openclaw config set tools.allow '["openclaw"]' --strict-json
```

### 3. Gateway Token (Local Relay)

ZhiHand needs to talk back to OpenClaw. Set the gateway token:

```bash
openclaw doctor --generate-gateway-token
export ZHIHAND_GATEWAY_TOKEN="$(python3 - <<'PY'
import json
from pathlib import Path
config = json.loads((Path.home() / '.openclaw' / 'openclaw.json').read_text())
print(config['gateway']['auth']['token'])
PY
)"
openclaw config set gateway.http.endpoints.responses.enabled true --strict-json
openclaw config set plugins.entries.openclaw.config.gatewayAuthToken "\"$ZHIHAND_GATEWAY_TOKEN\"" --strict-json
```

### 4. Pair

```text
/zhihand pair
```

## Mobile Apps (Android & iOS)

The apps for **Android** and **iOS** require minimal configuration beyond the initial pairing:

1.  **Scan**: Pair with your host agent.
2.  **Connect**: Connect to the **ZhiHand Device** (Hardware/BLE).
3.  **Eye**: Enable screen sharing.

### Advanced Settings

- **Control Plane**: Default is `https://api.zhihand.com`. Override in the app's settings if using a custom server.
- **BLE Lease**: The apps automatically manage BLE leases for the ZhiHand Device.

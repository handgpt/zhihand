# ZhiHand

ZhiHand lets AI agents (like Claude Code, Gemini CLI, and OpenClaw) see your phone and help operate it through the ZhiHand Device.

Current core version: `0.12.0`

## Architecture

ZhiHand is built on the **Model Context Protocol (MCP)**. The core implementation is a unified MCP Server that handles all business logic, tool definitions, and state management.

```text
                    ┌─────────────────────────────────┐
                    │          @zhihand/mcp            │
                    │  (Core Logic, Tools, State)      │
                    └──────────┬──────────────────┬────┘
                               │                  │
                    ┌──────────▼──────┐  ┌────────▼────────┐
                    │  MCP stdio/HTTP  │  │  OpenClaw Plugin │
                    │  (Direct CLI)    │  │  (Thin Wrapper)  │
                    └──────────┬──────┘  └────────┬────────┘
                               │                  │
              ┌────────────────┼──────────────────┼──────┐
              │                │                  │      │
        Claude Code      Gemini CLI       OpenClaw    Codex CLI
```

## Quick Start

### AI Agent Users (MCP)

The easiest way to use ZhiHand is via its MCP Server. This allows any MCP-compatible tool (like Claude Code or Gemini CLI) to use ZhiHand tools directly.

1.  **Install the MCP Server**:
    ```bash
    npm install -g @zhihand/mcp
    ```

2.  **Setup and Pair**:
    Run the setup command and follow the instructions to pair your phone:
    ```bash
    zhihand setup
    ```

3.  **Use with your favorite tool**:
    - **Claude Code**: It will automatically detect the MCP server if configured.
    - **Gemini CLI**: Add the `zhihand serve` command to your MCP configuration.

### OpenClaw Users

If you are using OpenClaw, you can install the plugin which acts as a thin wrapper around the MCP server:

1.  **Install the plugin**:
    ```bash
    openclaw plugins install @zhihand/openclaw
    ```

2.  **Configure and Trust**:
    ```bash
    openclaw config set plugins.allow '["openclaw"]' --strict-json
    openclaw config set tools.allow '["openclaw"]' --strict-json
    ```

3.  **Pair**:
    ```text
    /zhihand pair
    ```
    Scan the QR code in the Android app.

## Android & iOS Apps

1.  Download and install the ZhiHand app for **Android** or **iOS**.
2.  Tap **Scan** and scan the QR code from your AI agent.
3.  Connect your **ZhiHand Device**.
4.  Turn on **Eye** (screen sharing) when you want the agent to see your screen.

## What Runs Where

- **Mobile app (Android/iOS)**: Captures user input, uploads screen snapshots, and executes device-side actions.
- **ZhiHand server**: Stores pairing state, prompts, commands, and attachments.
- **MCP Server (@zhihand/mcp)**: The core implementation layer providing tools to AI agents.
- **OpenClaw plugin**: A wrapper for the MCP server specifically for OpenClaw users.

  Connects OpenClaw to the ZhiHand control plane and exposes `zhihand_*` tools.

## What This Repository Contains

This repository is the public core for ZhiHand:

- public docs
- public protocol and action model
- the OpenClaw host adapter
- reference service boundaries

It does not include private deployment secrets or private product infrastructure.

## Where To Read Next

- [Distribution](./docs/DISTRIBUTION.md)
  How users install and start using ZhiHand.
- [Configuration](./docs/CONFIGURATION.md)
  What most users need, and what advanced self-hosters can override.
- [Updates](./docs/UPDATES.md)
  How app and device updates are detected and delivered.
- [Android app repository](https://github.com/handgpt/zhihand-android)
  Mobile UI, permissions, pairing, and device-side execution.
- [ZhiHand server repository](https://github.com/handgpt/zhihand-server)
  Hosted control-plane deployment and service configuration.
- [README.zh-CN.md](./README.zh-CN.md)
  Chinese version.

## For Developers

If you are integrating or extending ZhiHand, these docs are the main reference:

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

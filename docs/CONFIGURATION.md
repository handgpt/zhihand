# Configuration

This page explains the smallest public-safe configuration that works for most users, then the overrides that advanced users can apply.

## If You Only Want The Hosted Setup

For the normal public path, most users only need:

1. the Android app
2. the OpenClaw plugin
3. one OpenClaw gateway token copied into the plugin config

Preferred plugin install:

```bash
openclaw plugins install clawhub:zhihand
```

If ClawHub is unavailable or rate-limited, use the npm compatibility package:

```bash
openclaw plugins install @zhihand/openclaw
```

One-time hosted setup:

The token extraction snippet below assumes `python3` is available on the OpenClaw host. If it is not, open `~/.openclaw/openclaw.json` and copy `gateway.auth.token` manually.

```bash
openclaw config set plugins.allow '["zhihand"]' --strict-json
openclaw config set tools.allow '["zhihand"]' --strict-json
openclaw doctor --generate-gateway-token
export ZHIHAND_GATEWAY_TOKEN="$(python3 - <<'PY'
import json
from pathlib import Path
config = json.loads((Path.home() / '.openclaw' / 'openclaw.json').read_text())
print(config['gateway']['auth']['token'])
PY
)"
openclaw config set gateway.http.endpoints.responses.enabled true --strict-json
openclaw config set plugins.entries.zhihand.config.gatewayAuthToken "\"$ZHIHAND_GATEWAY_TOKEN\"" --strict-json
```

Then run:

```text
/zhihand pair
```

## Why These Settings Matter

- `plugins.allow`
  Tells OpenClaw to trust the non-bundled plugin id.
- `tools.allow`
  Makes the optional `zhihand_*` tools available to the OpenClaw runtime.
- `gateway.http.endpoints.responses.enabled`
  Turns on the local OpenClaw `POST /v1/responses` route that the plugin relays into.
- `plugins.entries.zhihand.config.gatewayAuthToken`
  Gives the plugin the bearer token it needs for the local relay.

If you skip them, the plugin may install but pairing, relay, or tool execution will not work correctly. Legacy `openclaw` config keys are still accepted during migration, but new installs should use `zhihand`.

## What The User Sees

### In OpenClaw

The plugin provides:

- `/zhihand pair`
- `/zhihand status`
- `/zhihand unpair`
- `/zhihand update`
- `/zhihand update check`

### In The Mobile App

The app is expected to:

- scan the pairing QR code
- claim the pairing session
- keep the paired credential locally
- upload screen snapshots when screen sharing is active
- upload device-profile snapshots so the host can adapt behavior by runtime family
- upload prompts and attachments
- receive commands and replies over SSE, then execute device-side actions

## Recommended Hosted Defaults

For the hosted public path, the plugin already defaults to:

- pairing on `https://pair.zhihand.com`
- control-plane traffic on `https://api.zhihand.com`
- app download URL `https://zhihand.com/download`
- `gatewayResponsesEndpoint`: `http://127.0.0.1:18789/v1/responses`
- `mobileAgentId`: `zhihand-mobile`
- `updateCheckEnabled`: `true`
- `updateCheckIntervalHours`: `24`

Most users do not need to override these.

## Advanced OpenClaw Configuration

Advanced or self-hosted users can configure the plugin under:

```json
{
  "plugins": {
    "entries": {
      "zhihand": {
        "enabled": true,
        "config": {}
      }
    }
  }
}
```

Supported public config fields:

- `controlPlaneEndpoint`
  Base URL of the ZhiHand control plane.
  Default: `https://api.zhihand.com`
- `originListener`
  Optional public origin metadata for the host
- `displayName`
  Human-readable name shown during pairing
- `stableIdentity`
  Stable plugin identity so the same host can keep the same `edge-id`
- `pairingTTLSeconds`
  QR lifetime in seconds
- `appDownloadURL`
  App link shown with pairing output
- `gatewayResponsesEndpoint`
  Local OpenClaw `POST /v1/responses` endpoint
- `gatewayAuthToken`
  Local OpenClaw bearer token for the thin relay
- `mobileAgentId`
  Dedicated OpenClaw agent id for mobile prompts
- `updateCheckEnabled`
  Enable automatic npm compatibility-package update checks during startup
- `updateCheckIntervalHours`
  Minimum number of hours between automatic npm compatibility-package update checks
- `requestedScopes`
  Scope list embedded into the pairing descriptor

Public-safe minimum example:

```json
{
  "plugins": {
    "allow": ["zhihand"],
    "entries": {
      "zhihand": {
        "enabled": true,
        "config": {
          "gatewayAuthToken": "set-this-in-deployment"
        }
      }
    }
  }
}
```

CLI equivalent:

```bash
openclaw config set plugins.allow '["zhihand"]' --strict-json
openclaw config set tools.allow '["zhihand"]' --strict-json
openclaw config set gateway.http.endpoints.responses.enabled true --strict-json
openclaw config set plugins.entries.zhihand.config.gatewayAuthToken '"your-gateway-token"' --strict-json
```

Recommended host-side update command:

```bash
openclaw plugins update zhihand
```

This remains the correct update command even if the plugin was first installed from the npm compatibility package, because the runtime plugin id is still `zhihand`.

Use `openclaw plugins install clawhub:zhihand@<version>` only for a first install or a reinstall after deleting the extension directory. The npm fallback remains `openclaw plugins install @zhihand/openclaw@<version>`.

## OpenClaw Runtime Best Practice

The plugin should stay thin.

Recommended split:

- **plugin**
  pairing, control-plane transport, SSE event intake, `zhihand_*` tools
- **OpenClaw agent**
  reasoning, tool orchestration, final reply

Do not treat plugin-side planner loops or direct `codex exec` flows as the public contract.

Recommended dedicated agent shape:

```json
{
  "agents": {
    "list": [
      {
        "id": "zhihand-mobile",
        "model": "openai-codex/gpt-5.4",
        "tools": {
          "allow": ["zhihand"]
        }
      }
    ]
  }
}
```

## What You Usually Do Not Need To Change

For a normal hosted setup, you do not need to configure:

- a custom control-plane endpoint
- a custom app download URL
- a custom `mobileAgentId`
- manual edits to `~/.openclaw/openclaw.json`
- Control UI browser settings such as allowed origins

If you need mobile or server details, use these companion repos:

- [Android app repository](https://github.com/handgpt/zhihand-android)
- [iOS app repository](https://github.com/handgpt/zhihand-ios)
- [ZhiHand server repository](https://github.com/handgpt/zhihand-server)

## OpenAI Computer Tool Status

The recommended ZhiHand mobile model is still `openai-codex/gpt-5.4`, but the current OpenClaw relay path does **not** expose the GA OpenAI computer tool.

Current integration contract:

- local relay goes through OpenClaw `POST /v1/responses`
- OpenClaw currently accepts hosted **function tools** on that surface
- the mobile agent therefore operates through `zhihand_screen_read` and `zhihand_control`

Do not assume this means native OpenAI `computer_call` or `computer_call_output` support is active. To use the GA OpenAI computer tool, you would need upstream OpenClaw support for that tool type or a separate direct-to-OpenAI harness outside the current public ZhiHand plugin contract.

## OpenClaw Tools

The adapter exposes:

- `zhihand_pair`
- `zhihand_status`
- `zhihand_screen_read`
- `zhihand_control`

`zhihand_control` currently supports:

- `click`
- `long_click`
- `move`
- `move_to`
- `swipe`
- `back`
- `home`
- `enter`
- `input_text`
- `open_app`
- `set_clipboard`
- `start_live_capture`
- `stop_live_capture`

## Prompt Attachments

The mobile prompt path can include:

- images
- audio notes
- documents
- limited video attachments

Recommended practice:

- send images and documents as attachments
- send voice as raw audio attachments
- let the OpenClaw host perform transcription
- do not make app-local speech-to-text the primary public contract

## Pairing URL Behavior

`https://pair.zhihand.com/pair?d=<base64url>` supports two modes:

- browser mode
  - default
  - returns an HTML QR landing page
- machine mode
  - requested with `Accept: application/json` or `?format=json`
  - returns the raw pairing descriptor JSON

The normal user-facing flow is:

1. OpenClaw returns a QR URL
2. a browser shows the QR page
3. the Android app scans it
4. the app resolves the descriptor in JSON mode and claims it

## BLE Lease

ZhiHand Device uses a BLE lease so only one active nearby client controls the hardware at a time.

Public UUIDs:

- service: `0x1815`
- command characteristic: `0x2A56`
- lease characteristic: `0xFF02`

Public operations:

- `claim`
- `renew`
- `release`

Public results:

- `free`
- `leased`
- `granted`
- `renewed`
- `busy`
- `expired`

## Screen Capture

Remote screen reading depends on the Android app already holding an active local screen-sharing session.

The public model does not assume silent bypass of Android `MediaProjection` consent.

## Public Safety Rule

Do not place the following in this repository:

- real tokens
- real passwords
- real API keys
- private SSH targets
- operator credentials
- machine-specific internal paths

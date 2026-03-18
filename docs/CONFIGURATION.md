# Configuration

This page explains what most users need to configure, and what advanced users can override.

It is intentionally safe to publish.

## Most Users

If you use the hosted defaults, most users only need two things:

1. install the Android app
2. install the OpenClaw plugin

The normal install command is:

```bash
openclaw plugins install @zhihand/openclaw
```

Then add the plugin id to the OpenClaw allowlist:

```bash
openclaw config set plugins.allow '["openclaw"]' --strict-json
```

Then run:

```text
/zhihand pair
```

For the normal hosted setup, the plugin already defaults to:

- pairing on `https://pair.zhihand.com`
- control-plane traffic on `https://api.zhihand.com`
- app download URL `https://zhihand.com/download`

If you also need mobile or server details, use these companion repos:

- [Android app repository](https://github.com/handgpt/zhihand-android)
  Android behavior, permissions, and device-side settings.
- [iOS app repository](https://github.com/handgpt/zhihand-ios)
  iPhone/iPad client behavior and iOS-specific transport details.
- [ZhiHand server repository](https://github.com/handgpt/zhihand-server)
  Hosted control-plane deployment and operator-facing configuration.

## What the User Sees

### In OpenClaw

The plugin provides:

- `/zhihand pair`
- `/zhihand status`
- `/zhihand unpair`

### In the mobile app

The app is expected to:

- scan the pairing QR code
- claim the pairing session
- keep the paired credential locally
- upload screen snapshots when screen sharing is active
- upload device-profile snapshots so the host can adapt behavior by runtime family
- upload prompts and attachments
- receive commands and replies over SSE, then execute device-side actions

## Advanced OpenClaw Configuration

Advanced or self-hosted users can configure the plugin under:

```json
{
  "plugins": {
    "entries": {
      "openclaw": {
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
- `requestedScopes`
  Scope list embedded into the pairing descriptor

Public-safe example:

```json
{
  "plugins": {
    "allow": ["openclaw"],
    "entries": {
      "openclaw": {
        "enabled": true,
        "config": {
          "gatewayAuthToken": "set-this-in-deployment"
        }
      }
    }
  }
}
```

If you do not want to edit `~/.openclaw/openclaw.json` by hand, the allowlist can be added from the CLI:

```bash
openclaw config set plugins.allow '["openclaw"]' --strict-json
```

This is recommended because OpenClaw warns when `plugins.allow` is empty for non-bundled plugins.

## Recommended Hosted Defaults

The public plugin defaults to:

- `controlPlaneEndpoint`: `https://api.zhihand.com`
- `pairingTTLSeconds`: `600`
- `appDownloadURL`: `https://zhihand.com/download`
- `gatewayResponsesEndpoint`: `http://127.0.0.1:18789/v1/responses`
- `mobileAgentId`: `zhihand-mobile`

These defaults are recommended for the hosted public path.

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
          "allow": ["openclaw"]
        }
      }
    ]
  }
}
```

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

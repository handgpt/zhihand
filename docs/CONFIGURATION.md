# Public Configuration Surfaces

This document records the public, publishable configuration surfaces that other
repos and deployments are expected to consume.

It is intentionally safe to open source.

Do not place any of the following in this repository:

- real tokens, passwords, cookies, or API keys
- private server hostnames or SSH targets
- internal-only filesystem paths from a specific deployment
- per-user credentials or operator notes

## Public Hostnames

The public model assumes these host categories:

- `pair.zhihand.com`
  QR landing and mobile claim bootstrap
- `api.zhihand.com`
  deployment-specific control-plane base URL
- `<edge-id>.edge.zhihand.com`
  opaque per-host endpoint identity

Only the hostname categories belong here.
Concrete deployment values and secrets belong in deployment-specific docs.

## OpenClaw Host Adapter Config

The public OpenClaw plugin accepts the following config object under
`plugins.entries.zhihand.config`:

- `controlPlaneEndpoint`
  Base URL for the deployment control plane, for example
  `https://api.zhihand.com`
- `originListener`
  Public origin metadata for the host, for example
  `https://host.example.zhihand.com`
- `displayName`
  Human-friendly name shown in pairing state
- `stableIdentity`
  Stable plugin identity used to reuse the same `edge-id` across restarts
- `pairingTTLSeconds`
  Pairing QR lifetime in seconds, minimum `30`
- `appDownloadURL`
  Link shown to users when pairing is generated
- `gatewayResponsesEndpoint`
  Local OpenClaw `POST /v1/responses` endpoint used by the thin plugin relay
- `gatewayAuthToken`
  Gateway bearer token used for the local OpenClaw `POST /v1/responses` call
- `mobileAgentId`
  Dedicated OpenClaw agent id for ZhiHand mobile prompts
- `requestedScopes`
  Requested scopes embedded into the pairing descriptor

Required fields:

- `controlPlaneEndpoint`
- `originListener`

Public-safe example:

```json
{
  "plugins": {
    "entries": {
      "zhihand": {
        "enabled": true,
        "config": {
          "controlPlaneEndpoint": "https://api.zhihand.com",
          "originListener": "https://host.example.zhihand.com",
          "displayName": "ZhiHand @ example-host",
          "stableIdentity": "openclaw-zhihand:example-host",
          "pairingTTLSeconds": 600,
          "appDownloadURL": "https://zhihand.com/download",
          "gatewayResponsesEndpoint": "http://127.0.0.1:18789/v1/responses",
          "gatewayAuthToken": "set-this-in-deployment",
          "mobileAgentId": "zhihand-mobile",
          "requestedScopes": [
            "observe",
            "session.control",
            "ble.control"
          ]
        }
      }
    }
  }
}
```

The public plugin intentionally does **not** default to one private control
plane instance. Deployment-specific endpoints must be configured explicitly.

## OpenClaw Runtime Best Practice

The public ZhiHand plugin should stay thin.

Preferred runtime split:

- plugin: pairing, polling, control-plane transport, and `zhihand_*` tools
- OpenClaw agent/runtime: prompt reasoning, tool orchestration, and final reply

Do **not** treat plugin-side planner loops or direct `codex exec` flows as the
public contract. Those are implementation detours, not the intended architecture.

Recommended dedicated agent example:

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

Why:

- OpenClaw plugin docs define agent tools as the normal LLM integration point
- OpenClaw CLI backend docs define `codex-cli/*` as text-only fallback paths
  with tools disabled
- a native `POST /v1/responses` relay keeps policy, auditing, and tool scoping
  inside OpenClaw

Deployment requirements for this best practice:

- `gateway.http.endpoints.responses.enabled = true`
- the plugin receives a local gateway bearer token
- the dedicated ZhiHand mobile agent uses a tool-capable provider model such as
  `openai-codex/gpt-5.4`
- `zhihand_*` tools are registered as optional and allowlisted only for the
  dedicated mobile agent
- if these prerequisites are missing, the relay stays disabled and the plugin
  logs the configuration error during startup

## OpenClaw Adapter Commands And Tools

The public OpenClaw adapter exposes:

- slash commands
  - `/zhihand pair`
  - `/zhihand status`
  - `/zhihand unpair`
- tools
  - `zhihand_pair`
  - `zhihand_status`
  - `zhihand_screen_read`
  - `zhihand_control`

`zhihand_control` currently accepts these action values:

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

Coordinate best practice:

- `click`, `long_click`, and `move_to` use `xRatio` and `yRatio` in `[0,1]`
  based on the latest `zhihand_screen_read` image.
- `swipe` uses `x1Ratio`, `y1Ratio`, `x2Ratio`, and `y2Ratio` in `[0,1]`.
- `move` uses `dxRatio` and `dyRatio` in `[-1,1]` for relative pointer moves.
- Public callers should not send raw screenshot pixel coordinates.
- `zhihand_screen_read` should fail if the latest snapshot is stale, rather
  than letting the agent plan clicks from an old frame.
- If the Android keyboard is visible and the next step is to submit search,
  send, or confirm the current text, prefer `enter` over clicking the IME
  action button.
- `input_text` accepts `mode`:
  - `auto`: current default, resolved on Android as paste-first
  - `paste`: clipboard-first plus HID paste shortcut
  - `type`: raw HID keyboard typing for sensitive fields or paste-rejected inputs
- `input_text` accepts `submit=true` to send Enter immediately after the text
  input succeeds.
- `auto` and `paste` overwrite the Android clipboard as part of the
  reliability trade-off. Prefer `type` for sensitive text or when clipboard
  mutation is not acceptable.

## Pairing Descriptor Fields

The QR landing flow publishes a descriptor with these public fields:

- `v`
- `mode`
- `control_plane_host`
- `edge_id`
- `edge_host`
- `pair_session_id`
- `pair_token`
- `expires_at`
- `requested_scopes`

The descriptor is intentionally transport bootstrap data.
It is not a long-term credential.

## Android Public Expectations

The public integration model expects the Android app to:

- scan a QR code or open a pairing URL
- resolve the pairing descriptor from `pair.zhihand.com`
- claim the pairing session against the deployment control plane
- persist the returned long-term credential locally
- poll paired-host commands through the control plane
- upload the latest screen snapshot through the control plane when capture is active

The OpenClaw host adapter may later recover to a newer claimed pairing session
for the same `edge_id` if the local adapter state falls behind the active phone
claim. This recovery is host-side state reconciliation; it does not replace the
QR claim flow or mobile credential issuance.

## BLE Lease Contract

The Android app and ZhiHand hardware use a BLE lease contract so nearby devices
can compete safely for a single hardware session.

Public constants currently in use:

- command service UUID: `0x1815`
- command characteristic UUID: `0x2A56`
- lease characteristic UUID: `0xFF02`

Public lease operations:

- `claim`
- `renew`
- `release`

Public lease states/results:

- `free`
- `leased`
- `granted`
- `renewed`
- `busy`
- `expired`

## Screen-Capture Constraint

Remote screen reading depends on the Android app already holding a valid local
screen-capture session.

The public model does **not** assume that a remote command can silently grant
`MediaProjection` permission on Android.

In practice:

- `zhihand_screen_read` returns the latest uploaded snapshot
- `zhihand.start_live_capture` may return a permission-required result until the
  user has activated capture in the app

## Public State Artifacts

The OpenClaw plugin uses these state-relative artifacts inside the OpenClaw
state directory:

- `plugins/zhihand/state.json`
- `plugins/zhihand/latest-screen.jpg`

This repository intentionally does not document deployment-specific absolute
paths.

## Publishing Rule

If a configuration item contains any of these, it does not belong in this
public repository:

- a secret value
- a private infrastructure address
- an operator account
- a deployment password
- a token file path that only makes sense on one machine

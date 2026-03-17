# ZhiHand OpenClaw Adapter

This package provides the public OpenClaw-side adapter for ZhiHand.

It is a thin plugin layer on top of the shared ZhiHand control-plane contract.

## What It Does

- registers one OpenClaw host instance with the deployment control plane
- creates QR-based pairing sessions for the ZhiHand mobile app
- stores pairing state under the OpenClaw state directory
- fetches the latest uploaded phone screen snapshot
- sends control commands and waits for command ACK status

## Recommended Install

Primary release path:

```bash
openclaw plugins install @zhihand/openclaw
```

Development fallback from a local checkout:

```bash
openclaw plugins install --link /path/to/zhihand/packages/host-adapters/openclaw
```

Recommended discovery paths after npm publication:

- package README
- OpenClawDir or another community plugin directory
- external catalogs when the host deployment supports them

Do not assume a first-party plugin store UI is the only distribution path.

## OpenClaw Plugin Config

The plugin reads its config from:

- `plugins.entries.openclaw.config`

Supported fields:

- `controlPlaneEndpoint`
- `originListener`
- `displayName`
- `stableIdentity`
- `pairingTTLSeconds`
- `appDownloadURL`
- `gatewayResponsesEndpoint`
- `gatewayAuthToken`
- `mobileAgentId`
- `requestedScopes`

Normal hosted deployments can leave most fields empty.

Recommended minimum:

- no plugin config at all if `OPENCLAW_GATEWAY_TOKEN` is already available in the host environment
- otherwise only `gatewayAuthToken`

Example:

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

Advanced self-host example:

```json
{
  "plugins": {
    "allow": ["openclaw"],
    "entries": {
      "openclaw": {
        "enabled": true,
        "config": {
          "controlPlaneEndpoint": "https://api.example.com",
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
            "screen.read",
            "screen.capture",
            "ble.control"
          ]
        }
      }
    }
  }
}
```

Defaults:

- `controlPlaneEndpoint`: `https://api.zhihand.com`
- `pairingTTLSeconds`: `600`
- `appDownloadURL`: `https://zhihand.com/download`
- `gatewayResponsesEndpoint`: `http://127.0.0.1:18789/v1/responses`
- `mobileAgentId`: `zhihand-mobile`
- `requestedScopes`: recommended ZhiHand defaults
- `stableIdentity`: auto-generated from hostname
- `originListener`: optional; the control plane can fill a default host metadata value

Do not store secrets in this package or this public repository.

## Best Practice

Use a dedicated OpenClaw agent/runtime path for ZhiHand mobile prompts.

- normal chat and phone-operation requests should use the same OpenClaw agent
- the plugin should stay thin and only provide pairing, tools, and relay glue
- `zhihand_*` tools should be registered as optional and enabled only for the
  dedicated mobile agent
- do **not** reintroduce a plugin-owned planner loop or direct `codex exec`
  orchestration inside this public plugin

Recommended deployment shape:

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

Why this is the preferred path:

- official OpenClaw plugin docs expect tools to be exposed to the agent runtime
- official OpenClaw CLI backend docs treat `codex-cli/*` as text-only fallback
  paths where tools are disabled
- keeping the planner inside the native runtime preserves gateway policy,
  auditability, and tool scoping

Deployment requirements for the native runtime path:

- the OpenClaw gateway must expose local `POST /v1/responses`
- the deployment must provide a gateway bearer token to the plugin
- the dedicated ZhiHand mobile agent must use a tool-capable provider model
  such as `openai-codex/gpt-5.4`, not `codex-cli/*`
- if these native-runtime prerequisites are missing, the prompt relay stays
  disabled and logs the configuration error during startup

## Release Shape

Recommended first public release:

- mobile app
- hosted `pair.zhihand.com` and `api.zhihand.com`
- npm-published OpenClaw plugin

For non-OpenClaw hosts, publish additional thin adapters on top of the same
control-plane contract instead of growing this package into a multi-host shell.

## Slash Commands

- `/zhihand pair`
- `/zhihand status`
- `/zhihand unpair`

`/zhihand pair` returns a browser-first pairing summary:

- app download URL
- QR URL

Open the QR URL in a browser to display the actual scannable QR page.

The current hosted control path is:

- HTTP requests for pairing, uploads, acknowledgements, and control writes
- SSE downlink for prompt, reply, and command events
- per-device profile snapshots so the host can adapt behavior by runtime family

## Tools

- `zhihand_pair`
- `zhihand_status`
- `zhihand_screen_read`
- `zhihand_control`

`zhihand_control` supports:

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

Coordinate rules:

- `click`, `long_click`, and `move_to` use `xRatio` and `yRatio` in `[0,1]`
  from the latest screenshot.
- `swipe` uses `x1Ratio`, `y1Ratio`, `x2Ratio`, and `y2Ratio` in `[0,1]`.
- `move` uses `dxRatio` and `dyRatio` in `[-1,1]` for relative pointer deltas.
- Do not send raw screenshot pixel coordinates through the public tool API.
- `zhihand_screen_read` should be treated as fresh-only visual state. If the
  latest uploaded snapshot is stale, the tool fails instead of letting the
  agent click from an old frame.
- When a keyboard is visible and the goal is to submit search, send, or confirm
  text, prefer `enter` over clicking the IME action button.
- `input_text` supports `mode`:
  - `auto`: current default, resolved on the mobile runtime as `paste`
  - `paste`: clipboard-first plus HID paste shortcut
  - `type`: raw HID keyboard typing, reserved for sensitive fields or when paste fails
- `input_text` also supports `submit=true` to send Enter immediately after the
  text input completes.
- `auto` and `paste` overwrite the mobile runtime clipboard as part of the
  reliability trade-off. Use `type` for sensitive fields or when clipboard
  mutation is not acceptable.

## State Files

Relative to the OpenClaw state directory:

- `plugins/openclaw/state.json`
  stored pairing state for the host instance
- `plugins/openclaw/latest-screen.jpg`
  last fetched screen snapshot cache

The adapter may automatically advance local pairing state to the latest claimed
session for the same host edge when the stored pairing becomes stale. This is a
host-side recovery path and does not change the public QR claim flow.

## Pairing Flow

1. The host registers itself against the control plane.
2. The plugin creates a pairing session and pair URL.
3. The pair URL is the canonical QR landing page; browsers render a scannable
   HTML page, while the mobile app resolves the same URL in JSON mode.
4. The mobile app scans the QR code and claims the pairing session.
5. The control plane returns a long-lived mobile credential.
6. OpenClaw can then use `zhihand_status`, `zhihand_screen_read`, and
   `zhihand_control`.
7. If the phone later claims a newer pairing session for the same host edge,
   the adapter can recover forward to that latest claimed session instead of
   staying pinned to an older local credential.

## Mobile Prompt Path

The supported runtime path is:

1. The mobile app uploads a prompt to the control plane.
2. The mobile app may also upload prompt attachments before the prompt itself.
3. The OpenClaw plugin polls pending prompts.
4. The plugin downloads any prompt attachments from the control plane.
5. The plugin prepares multimodal native-agent input:
   - images become `input_image`
   - supported documents become `input_file`
   - audio attachments are transcribed into text context
   - video attachments stay limited context and may use preview images
6. The plugin forwards the prepared prompt to the local OpenClaw `POST /v1/responses`
   endpoint for the dedicated mobile agent.
7. The dedicated mobile agent decides whether to answer directly or call
   `zhihand_status`, `zhihand_screen_read`, and `zhihand_control`.
8. The plugin writes the final assistant reply back to the control plane.

Task cancellation also uses this same path:

6. If the mobile app marks the active prompt as `cancelled`, the plugin aborts the
   in-flight native mobile-agent run.
7. The final reply for that prompt becomes a system message indicating that the
   user stopped the task.

## Capture Constraint

`zhihand_screen_read` returns the latest uploaded snapshot, not a live video
stream.

`start_live_capture` may return a permission-required result until the mobile app
app already has an active screen-capture session.

## Attachment Best Practice

Preferred handling:

- images and documents remain raw attachments
- voice notes remain raw audio attachments and are transcribed on the host
- The mobile app should not treat app-local speech-to-text as the canonical contract
- video support is intentionally conservative and should be treated as limited
  context until the deployment adds explicit video understanding

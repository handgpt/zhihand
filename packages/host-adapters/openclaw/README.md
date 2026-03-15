# ZhiHand OpenClaw Adapter

This package provides the public OpenClaw-side adapter for ZhiHand.

It is a thin plugin layer on top of the shared ZhiHand control-plane contract.

## What It Does

- registers one OpenClaw host instance with the deployment control plane
- creates QR-based pairing sessions for the Android app
- stores pairing state under the OpenClaw state directory
- fetches the latest uploaded phone screen snapshot
- sends control commands and waits for command ACK status

## OpenClaw Plugin Config

The plugin reads its config from:

- `plugins.entries.zhihand.config`

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

Required fields:

- `controlPlaneEndpoint`
- `originListener`

Example:

```json
{
  "plugins": {
    "allow": ["zhihand"],
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

Do not store secrets in this package or this public repository.

The public plugin intentionally does **not** hardcode one deployment control
plane or host origin. Those values must be supplied by the deployment.

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
          "allow": ["zhihand"]
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

## Slash Commands

- `/zhihand pair`
- `/zhihand status`
- `/zhihand unpair`

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
  - `auto`: current default, resolved on Android as `paste`
  - `paste`: clipboard-first plus HID paste shortcut
  - `type`: raw HID keyboard typing, reserved for sensitive fields or when paste fails
- `input_text` also supports `submit=true` to send Enter immediately after the
  text input completes.
- `auto` and `paste` overwrite the Android system clipboard as part of the
  reliability trade-off. Use `type` for sensitive fields or when clipboard
  mutation is not acceptable.

## State Files

Relative to the OpenClaw state directory:

- `plugins/zhihand/state.json`
  stored pairing state for the host instance
- `plugins/zhihand/latest-screen.jpg`
  last fetched screen snapshot cache

## Pairing Flow

1. The host registers itself against the control plane.
2. The plugin creates a pairing session and pair URL.
3. The Android app scans the QR code and claims the pairing session.
4. The control plane returns a long-lived mobile credential.
5. OpenClaw can then use `zhihand_status`, `zhihand_screen_read`, and
   `zhihand_control`.

## Mobile Prompt Path

The supported runtime path is:

1. Android app uploads a mobile prompt to the control plane.
2. The OpenClaw plugin polls pending prompts.
3. The plugin forwards the prompt to the local OpenClaw `POST /v1/responses`
   endpoint for the dedicated mobile agent.
4. The dedicated mobile agent decides whether to answer directly or call
   `zhihand_status`, `zhihand_screen_read`, and `zhihand_control`.
5. The plugin writes the final assistant reply back to the control plane.

Task cancellation also uses this same path:

6. If Android marks the active prompt as `cancelled`, the plugin aborts the
   in-flight native mobile-agent run.
7. The final reply for that prompt becomes a system message indicating that the
   user stopped the task.

## Capture Constraint

`zhihand_screen_read` returns the latest uploaded snapshot, not a live video
stream.

`start_live_capture` may return a permission-required result until the Android
app already has an active screen-capture session.

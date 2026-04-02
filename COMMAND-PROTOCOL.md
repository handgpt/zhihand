# ZhiHand Command Protocol — Unified Specification

> **Version**: 1.1.0 (2026-04-02)
> **Status**: All 4 endpoints (Android, iOS, Server, MCP) are aligned to this spec.

## Overview

This document defines the canonical set of device-control commands used across all ZhiHand components. Every command flows through the same pipeline:

```
MCP/Controller → Server (enqueue) → Device App (execute + ACK) → Server (store ACK) → MCP/Controller (read result)
```

All endpoints MUST support the commands listed here. Any command not in this list MUST return `ack_status: "unsupported"`.

---

## Wire Format

### Command Envelope

```json
{
  "type": "receive_<action>",
  "payload": { ... },
  "message_id": 1743562800001
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `type` | string | yes | Command type, always prefixed with `receive_` |
| `payload` | object | yes | Action-specific parameters (empty `{}` if none) |
| `message_id` | integer | yes | Unique message identifier (timestamp-based) |

### ACK Response

```json
{
  "status": "ok | failed | unsupported | invalid_request",
  "result": { "execution_method": "ble_hid | local", ... }
}
```

---

## Coordinate System

All position parameters use **normalized ratios** `[0.0, 1.0]`:

| Parameter | Type | Range | Description |
|-----------|------|-------|-------------|
| `x` / `x1` / `x2` | float | 0.0–1.0 | Horizontal position (0=left, 1=right) |
| `y` / `y1` / `y2` | float | 0.0–1.0 | Vertical position (0=top, 1=bottom) |

> **Note**: `source_width` and `source_height` are optional legacy fields for absolute pixel coordinates. New code SHOULD always use ratios and omit these fields.

---

## Command Catalog

### 1. Click Commands

#### `receive_click`
Single tap/click at a position.

| Payload Field | Type | Required | Default | Description |
|---------------|------|----------|---------|-------------|
| `x` | float | yes | — | Horizontal ratio [0,1] |
| `y` | float | yes | — | Vertical ratio [0,1] |

#### `receive_doubleclick`
Double tap/click at a position.

| Payload Field | Type | Required | Default | Description |
|---------------|------|----------|---------|-------------|
| `x` | float | yes | — | Horizontal ratio [0,1] |
| `y` | float | yes | — | Vertical ratio [0,1] |

#### `receive_longclick`
Long press at a position.

| Payload Field | Type | Required | Default | Description |
|---------------|------|----------|---------|-------------|
| `x` | float | yes | — | Horizontal ratio [0,1] |
| `y` | float | yes | — | Vertical ratio [0,1] |
| `time` | integer | no | 800 | Hold duration in milliseconds |

#### `receive_rightclick`
Right-click at a position (desktop/BLE HID contexts).

| Payload Field | Type | Required | Default | Description |
|---------------|------|----------|---------|-------------|
| `x` | float | yes | — | Horizontal ratio [0,1] |
| `y` | float | yes | — | Vertical ratio [0,1] |

#### `receive_middleclick`
Middle-click at a position (desktop/BLE HID contexts).

| Payload Field | Type | Required | Default | Description |
|---------------|------|----------|---------|-------------|
| `x` | float | yes | — | Horizontal ratio [0,1] |
| `y` | float | yes | — | Vertical ratio [0,1] |

---

### 2. Gesture Commands

#### `receive_slide`
Swipe/drag from one point to another.

| Payload Field | Type | Required | Default | Description |
|---------------|------|----------|---------|-------------|
| `x1` | float | yes | — | Start horizontal ratio [0,1] |
| `y1` | float | yes | — | Start vertical ratio [0,1] |
| `x2` | float | yes | — | End horizontal ratio [0,1] |
| `y2` | float | yes | — | End vertical ratio [0,1] |
| `time` | integer | no | 300 | Swipe duration in milliseconds |

> **MCP alias**: `swipe` → `receive_slide`

#### `receive_scroll`
Scroll at a position.

| Payload Field | Type | Required | Default | Description |
|---------------|------|----------|---------|-------------|
| `x` | float | yes | — | Scroll origin horizontal ratio [0,1] |
| `y` | float | yes | — | Scroll origin vertical ratio [0,1] |
| `direction` | string | no | `"down"` | One of: `up`, `down`, `left`, `right` |
| `amount` | integer | no | 3 | Number of scroll steps |

---

### 3. Text Input Commands

#### `receive_input`
Type text into the focused input field.

| Payload Field | Type | Required | Default | Description |
|---------------|------|----------|---------|-------------|
| `input` | string | yes | — | Text to type |
| `mode` | string | no | `"auto"` | Input mode: `auto`, `paste`, `type` |
| `submit` | boolean | no | `false` | Press Enter after input |

**Mode behavior:**
- `auto` — Platform decides (typically resolves to `paste` on Android)
- `paste` — Copy to clipboard, then paste (fast, supports Unicode)
- `type` — Simulate individual keystrokes via BLE HID (ASCII only, slower)

> **MCP alias**: `type` → `receive_input`

---

### 4. Keyboard Commands

#### `receive_key_combo`
Press a keyboard shortcut combination.

| Payload Field | Type | Required | Default | Description |
|---------------|------|----------|---------|-------------|
| `keys` | string | yes | — | Key combo string, e.g. `ctrl+c`, `alt+tab`, `cmd+s` |

**Format**: Modifier keys separated by `+`, last element is the key.
**Supported modifiers**: `ctrl`, `alt`, `shift`, `cmd`/`meta`/`win`/`gui`

> **MCP alias**: `keycombo` → `receive_key_combo`

#### `receive_back`
Press the system Back button / Escape key.

| Payload | — | — | — |
|---------|---|---|---|
| *(empty object)* | | | |

#### `receive_home`
Press the system Home button.

| Payload | — | — | — |
|---------|---|---|---|
| *(empty object)* | | | |

#### `receive_enter`
Press the Enter key.

| Payload | — | — | — |
|---------|---|---|---|
| *(empty object)* | | | |

#### `receive_key`
Send a raw HID key report (low-level, rarely used by AI).

| Payload Field | Type | Required | Default | Description |
|---------------|------|----------|---------|-------------|
| `key` | string | yes | — | Base64-encoded HID key report bytes |

---

### 5. System Commands

#### `receive_screenshot`
Capture the current screen. No device action is performed.

| Payload | — | — | — |
|---------|---|---|---|
| *(empty object)* | | | |

**Response**: The device ACKs and attaches a JPEG screenshot frame.

#### `receive_app`
Open an application on the device.

| Payload Field | Type | Required | Default | Description |
|---------------|------|----------|---------|-------------|
| `app_package` | string | conditional | — | Android package name (e.g. `com.tencent.mm`) |
| `bundle_id` | string | conditional | — | iOS bundle ID (e.g. `com.tencent.xin`) |
| `url_scheme` | string | conditional | — | URL scheme to open (e.g. `weixin://`) |
| `app_name` | string | no | — | Human-readable name (for logging) |

> At least one of `app_package`, `bundle_id`, or `url_scheme` MUST be provided.

> **MCP alias**: `open_app` → `receive_app`

#### `receive_clipboard`
Read or write the system clipboard.

| Payload Field | Type | Required | Default | Description |
|---------------|------|----------|---------|-------------|
| `action` | string | yes | — | `get` or `set` |
| `text` | string | conditional | — | Required when action=`set` |

**Response for `get`**: `ack_result` contains `{ "clipboard": "<text>" }`.

---

### 6. Chat Command (Internal)

#### `receive_message`
Deliver a chat message to the device UI. Not used for device control.

| Payload Field | Type | Required | Default | Description |
|---------------|------|----------|---------|-------------|
| `message` | string | yes | — | Message text |

---

## MCP Action ↔ Wire Type Mapping

This table shows the mapping between high-level MCP `zhihand_control` action names and the wire `type` field:

| MCP Action | Wire Type | Key Payload Differences |
|------------|-----------|------------------------|
| `click` | `receive_click` | `xRatio,yRatio` → `x,y` |
| `doubleclick` | `receive_doubleclick` | `xRatio,yRatio` → `x,y` |
| `rightclick` | `receive_rightclick` | `xRatio,yRatio` → `x,y` |
| `middleclick` | `receive_middleclick` | `xRatio,yRatio` → `x,y` |
| `longclick` | `receive_longclick` | `xRatio,yRatio,durationMs` → `x,y,time` |
| `type` | `receive_input` | `text` → `input`, adds `mode,submit` |
| `swipe` | `receive_slide` | `startXRatio,...` → `x1,y1,x2,y2,time` |
| `scroll` | `receive_scroll` | `xRatio,yRatio` → `x,y` |
| `keycombo` | `receive_key_combo` | same: `keys` |
| `clipboard` | `receive_clipboard` | `clipboardAction` → `action` |
| `screenshot` | `receive_screenshot` | no payload |
| `open_app` | `receive_app` | `appPackage,bundleId,urlScheme,appName` |
| `back` | `receive_back` | no payload |
| `home` | `receive_home` | no payload |
| `enter` | `receive_enter` | no payload |
| `wait` | *(local only)* | MCP-side sleep, no wire command |

---

## Platform Support Matrix

| Wire Type | Android | iOS | Server | MCP |
|-----------|---------|-----|--------|-----|
| `receive_click` | ✅ | ✅ | ✅ relay | ✅ |
| `receive_doubleclick` | ✅ | ✅ | ✅ relay | ✅ |
| `receive_rightclick` | ✅ | ✅ | ✅ relay | ✅ |
| `receive_middleclick` | ✅ | ✅ | ✅ relay | ✅ |
| `receive_longclick` | ✅ | ✅ | ✅ relay | ✅ |
| `receive_slide` | ✅ | ✅ | ✅ relay | ✅ |
| `receive_scroll` | ✅ | ✅ | ✅ relay | ✅ |
| `receive_input` | ✅ | ✅ | ✅ relay | ✅ |
| `receive_key_combo` | ✅ | ✅ | ✅ relay | ✅ |
| `receive_key` | ✅ | ✅ | ✅ relay | — low-level |
| `receive_back` | ✅ | ✅ | ✅ relay | ✅ |
| `receive_home` | ✅ | ✅ | ✅ relay | ✅ |
| `receive_enter` | ✅ | ✅ | ✅ relay | ✅ |
| `receive_screenshot` | ✅ | ✅ | ✅ relay | ✅ |
| `receive_app` | ✅ | ✅ | ✅ relay | ✅ |
| `receive_clipboard` | ✅ | ✅ | ✅ relay | ✅ |
| `receive_message` | ✅ | ✅ | ✅ relay | — internal |

**Legend**: ✅ implemented, — not applicable

---

## Implementation Status

### MCP (`zhihand/packages/mcp`) — All done as of v0.20.0
1. ~~**Add MCP actions**: `longclick`, `back`, `home`, `enter`, `open_app`~~ ✅ (v0.18.0)
2. ~~**Fix wire type names**: `receive_swipe` → `receive_slide`, `receive_keycombo` → `receive_key_combo`, `receive_type` → `receive_input`~~ ✅ (v0.18.0)
3. ~~**Fix payload field names**: swipe `startX/endX` → `x1/x2/y1/y2/time`, type `text` → `input`~~ ✅ (v0.18.0)
4. ~~**Update `controlSchema`**: add new actions to enum, add `appPackage`, `bundleId`, `urlScheme`, `appName` params~~ ✅ (v0.18.0)
5. ~~**Fix `durationMs` default regression**~~ ✅ (v0.18.1)
6. ~~**Fix SSE command ACK URL**~~ ✅ (v0.18.2)
7. ~~**Platform-aware executable resolution for gemini/claude/codex**~~ ✅ (v0.19.0)
8. ~~**Default model aliases + `--model` flag + version/model logging**~~ ✅ (v0.20.0)

### Server (`zhihand-server`)
- No changes needed — server is a passthrough relay. Any `type` + `payload` object is accepted and forwarded.

### Android (`zhihand-android`)
- Already supports all commands. No changes needed.

### iOS (`zhihand-ios`)
- Already supports all commands. No changes needed.

---

## Versioning

This protocol is versioned independently of any component. When adding or changing commands:
1. Bump the spec version in this document
2. Update the platform support matrix
3. Update each affected component

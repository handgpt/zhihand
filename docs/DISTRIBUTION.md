# Distribution

This page explains how ZhiHand is meant to be delivered to real users.

## The Product Shape

ZhiHand is easiest to use when it is delivered in three parts:

1. **ZhiHand mobile app**
2. **Hosted ZhiHand control plane**
3. **OpenClaw plugin**

That means a new user does not need to self-host anything on day one.

## What Most Users Install

### 1. ZhiHand mobile app

The app is where the user:

- scans the pairing QR code
- connects `ZhiHand Device`
- grants screen sharing when needed
- sends requests, voice notes, and attachments

### 2. OpenClaw plugin

The normal install command is:

```bash
openclaw plugins install @zhihand/openclaw
```

Then add the explicit plugin allowlist entry:

```bash
openclaw config set plugins.allow '["openclaw"]' --strict-json
```

This is the main public install path.

Local-path install is only for plugin development:

```bash
openclaw plugins install --link /path/to/zhihand/packages/host-adapters/openclaw
```

## First-Run User Flow

1. Install the Android app.
2. Install the OpenClaw plugin.
3. Run `openclaw config set plugins.allow '["openclaw"]' --strict-json`.
4. Restart or reload OpenClaw if needed.
5. Run `/zhihand pair`.
6. Open the QR URL in a browser.
7. Scan it from the mobile app.
8. Connect `ZhiHand Device`.
9. Turn on `Eye` when you want ZhiHand to read the screen.
10. Start sending requests from the phone or from OpenClaw.

## What Runs Where

- **ZhiHand mobile app**
  Handles pairing, screen sharing, attachments, device-profile uploads, and device-side execution.
- **Hosted control plane**
  Stores pairing state, prompts, replies, commands, and attachments.
- **OpenClaw plugin**
  Connects OpenClaw to the control plane and exposes `zhihand_*` tools.

Related implementation repos:

- [Android app repository](https://github.com/handgpt/zhihand-android)
- [ZhiHand server repository](https://github.com/handgpt/zhihand-server)

## Hosted By Default

The recommended first release is hosted by default:

- the Android app uses the official hosted endpoints
- the OpenClaw plugin points to the official hosted control plane
- self-hosting is optional, not required for first use

## Discovery

Recommended discovery paths:

- this repository README
- the plugin README
- npm package page
- OpenClawDir or another community plugin directory

Do not assume users have a built-in plugin-store UI inside every OpenClaw deployment.

## For Advanced Users

Advanced users can still self-host by overriding the control-plane endpoint.

That is an advanced deployment path, not the default onboarding path.

## Recommended OpenClaw Trust Step

OpenClaw warns when a non-bundled plugin is installed but `plugins.allow` is empty.

For ZhiHand, the recommended one-time trust step is:

```bash
openclaw config set plugins.allow '["openclaw"]' --strict-json
```

If you pin package versions in production for a first install or a reinstall after deleting the existing extension directory, install the exact published version and keep the same allowlist:

```bash
openclaw plugins install @zhihand/openclaw@0.9.3
openclaw config set plugins.allow '["openclaw"]' --strict-json
```

The plugin checks npm for published updates during startup by default.
Use `/zhihand update` to print the recommended host-side update command, then reload OpenClaw.

Recommended host-side update command:

```bash
openclaw plugins update openclaw
```

For an installed plugin, use `openclaw plugins update openclaw`. The pinned `openclaw plugins install @zhihand/openclaw@<version>` form is create-only and is intended for a first install or a reinstall after removal.

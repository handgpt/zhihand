# Distribution

This page explains how ZhiHand is meant to be delivered to real users.

## The Product Shape

ZhiHand is easiest to use when it is delivered in three parts:

1. **Android app**
2. **Hosted ZhiHand control plane**
3. **OpenClaw plugin**

That means a new user does not need to self-host anything on day one.

## What Most Users Install

### 1. Android app

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

This is the main public install path.

Local-path install is only for plugin development:

```bash
openclaw plugins install --link /path/to/zhihand/packages/host-adapters/openclaw
```

## First-Run User Flow

1. Install the Android app.
2. Install the OpenClaw plugin.
3. Restart or reload OpenClaw if needed.
4. Run `/zhihand pair`.
5. Open the QR URL in a browser.
6. Scan it from the Android app.
7. Connect `ZhiHand Device`.
8. Turn on `Eye` when you want ZhiHand to read the screen.
9. Start sending requests from the phone or from OpenClaw.

## What Runs Where

- **Android app**
  Handles pairing, screen sharing, attachments, and device-side execution.
- **Hosted control plane**
  Stores pairing state, prompts, replies, commands, and attachments.
- **OpenClaw plugin**
  Connects OpenClaw to the control plane and exposes `zhihand_*` tools.

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

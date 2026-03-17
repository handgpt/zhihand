# ZhiHand

ZhiHand lets OpenClaw see your phone and help operate it through the ZhiHand Device.

In practice, ZhiHand brings three parts together:

- `Brain`
  OpenClaw receives the request and decides what to do.
- `Eye`
  The Android app shares the current screen when you allow it.
- `Hand`
  ZhiHand Device sends the actual input to the phone.

## What Users Do

Most users only need this flow:

1. Install the Android app.
2. Install the OpenClaw plugin.
3. Run `/zhihand pair` in OpenClaw.
4. Scan the QR code in the app.
5. Connect `ZhiHand Device`.
6. Turn on screen sharing when you want ZhiHand to see the screen.
7. Start asking OpenClaw to help.

If you use the hosted defaults, you do not need to deploy your own server first.

## Quick Start

### OpenClaw user

Install the plugin:

```bash
openclaw plugins install @zhihand/openclaw
```

Then restart or reload OpenClaw if your setup requires it, and run:

```text
/zhihand pair
```

Open the returned QR URL in a browser and scan it from the Android app.

### Android user

1. Open the ZhiHand app.
2. Tap `Scan`.
3. Scan the QR code from OpenClaw.
4. Connect `ZhiHand Device`.
5. Tap `Eye` when you want ZhiHand to read the screen.

## What Runs Where

- **Android app**
  Captures user input, uploads screen snapshots, and executes device-side actions.
- **ZhiHand server**
  Stores pairing state, prompts, replies, commands, and attachments.
- **OpenClaw plugin**
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
- [REPOSITORY.md](./docs/REPOSITORY.md)
- [CLIENT_REPOS.md](./docs/CLIENT_REPOS.md)
- [ROADMAP.md](./ROADMAP.md)

## Publishing Rule

Public documentation in this repository must stay safe to publish:

- no real tokens
- no private hostnames
- no operator credentials
- no deployment-only notes

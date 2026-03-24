# ZhiHand

ZhiHand lets OpenClaw see an Android phone and help operate it through `ZhiHand Device`.

Current core version: `0.10.1`

## Start Here

ZhiHand is for people who want one workflow across three pieces:

- `Brain`
  OpenClaw decides what to do next.
- `Eye`
  The Android app shares the current screen only when you allow it.
- `Hand`
  `ZhiHand Device` sends the actual phone input.

The recommended first-time path is:

1. Install the Android app.
2. Install the OpenClaw plugin.
3. Run `/zhihand pair`.
4. Scan the QR code from the app.
5. Connect `ZhiHand Device`.
6. Turn on `Eye` only when you want ZhiHand to read the screen.
7. Ask OpenClaw to help.

You do not need to self-host anything for a normal first run.

## Before You Start

The shortest working setup assumes:

- an Android phone with the ZhiHand app
- a `ZhiHand Device`
- an OpenClaw host where you can run `openclaw` commands
- shell access to the OpenClaw host so you can set one plugin token

## Fastest Setup

Preferred install path:

```bash
openclaw plugins install clawhub:zhihand
```

If ClawHub is unavailable or rate-limited in your environment, use the npm compatibility package:

```bash
openclaw plugins install @zhihand/openclaw
```

Then run the one-time OpenClaw setup:

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

If your OpenClaw deployment requires a restart or reload, do that now. Then run:

```text
/zhihand pair
```

Open the returned QR URL in a browser and scan it from the Android app.

## What Success Looks Like

Your setup is on the right path when:

- `/zhihand pair` returns a QR URL instead of an error
- the app claims the pairing session
- `ZhiHand Device` connects successfully
- `/zhihand status` shows the paired host is reachable
- screen reading only starts after you turn on `Eye`

## Install And Update Rules

For installed plugins, the normal update command is:

```bash
openclaw plugins update zhihand
```

This remains the correct update command even if the plugin was first installed through the npm compatibility package, because the runtime plugin id is still `zhihand`.

Use `openclaw plugins install clawhub:zhihand@<version>` only for a first install or after deleting the existing extension directory. The npm compatibility fallback remains `openclaw plugins install @zhihand/openclaw@<version>`.

The plugin checks the npm compatibility package for published updates during startup by default. Use `/zhihand update check` for a fresh lookup, or `/zhihand update` to print the recommended host-side command.

## Choose The Right Doc

- [Distribution](./docs/DISTRIBUTION.md)
  Start here if you are a new user, an operator preparing a rollout, or someone choosing between ClawHub and npm.
- [Configuration](./docs/CONFIGURATION.md)
  Start here if you want the minimum hosted setup, or need to override defaults for self-hosting.
- [Updates](./docs/UPDATES.md)
  Start here if you need to understand plugin, app, or device update behavior.
- [OpenClaw adapter README](./packages/host-adapters/openclaw/README.md)
  Start here if you landed on the plugin package and only care about the OpenClaw side.
- [README.zh-CN.md](./README.zh-CN.md)
  Chinese version.

## What Runs Where

- **Mobile app**
  Captures user input, uploads screen snapshots and device-profile context, and executes device-side actions.
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

## Related Repositories

- [Android app repository](https://github.com/handgpt/zhihand-android)
  Mobile UI, pairing, permissions, and device-side execution.
- [iOS app repository](https://github.com/handgpt/zhihand-ios)
  iPhone and iPad client behavior.
- [ZhiHand server repository](https://github.com/handgpt/zhihand-server)
  Hosted control-plane deployment and server configuration.

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

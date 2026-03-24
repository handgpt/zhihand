# Distribution

This page explains the public delivery path for ZhiHand from a first-time user point of view.

## Recommended Default Path

For most users, ZhiHand should arrive as three parts:

1. **ZhiHand mobile app**
2. **Hosted ZhiHand control plane**
3. **OpenClaw plugin**

That means a new user should not need to self-host anything on day one.

## What A New User Actually Needs

### Mobile side

The app is where the user:

- scans the pairing QR code
- connects `ZhiHand Device`
- enables screen sharing only when needed
- sends text, voice notes, and attachments

### OpenClaw side

The preferred install path is:

```bash
openclaw plugins install clawhub:zhihand
```

If ClawHub is unavailable or rate-limited in the current environment, use the npm compatibility package:

```bash
openclaw plugins install @zhihand/openclaw
```

Then complete the one-time host setup:

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

Local-path install is for plugin development only:

```bash
openclaw plugins install --link /path/to/zhihand/packages/host-adapters/openclaw
```

## First Successful Run

After the plugin is installed, the normal first-run flow is:

1. Install the Android app.
2. Install the OpenClaw plugin.
3. Add `zhihand` to `plugins.allow`.
4. Add `zhihand` to `tools.allow`.
5. Enable `gateway.http.endpoints.responses.enabled`.
6. Set `plugins.entries.zhihand.config.gatewayAuthToken` to the current OpenClaw gateway token.
7. Restart or reload OpenClaw if the deployment requires it.
8. Run `/zhihand pair`.
9. Open the QR URL in a browser.
10. Scan it from the mobile app.
11. Connect `ZhiHand Device`.
12. Turn on `Eye` only when you want ZhiHand to read the screen.
13. Start sending requests from the phone or from OpenClaw.

## What Success Looks Like

The onboarding path is working when:

- `/zhihand pair` returns a QR URL
- the app claims the pairing session
- the device connects
- `/zhihand status` shows the paired host is reachable
- screen reading only starts after `Eye` is enabled

## Common Setup Misses

- `plugins.allow is empty`
  Add `zhihand` to `plugins.allow`.
- `ZhiHand optional tools are not enabled for OpenClaw agent`
  Add `zhihand` to `tools.allow`.
- `OpenClaw /v1/responses returned 404`
  Enable `gateway.http.endpoints.responses.enabled`.
- `ZhiHand prompt relay disabled ... gatewayAuthToken`
  Set `plugins.entries.zhihand.config.gatewayAuthToken` to the current OpenClaw gateway token.
- ClawHub install fails because the service is temporarily unavailable
  Retry later or use `openclaw plugins install @zhihand/openclaw` as the compatibility path.

## What Runs Where

- **ZhiHand mobile app**
  Handles pairing, screen sharing, attachments, device-profile uploads, and device-side execution.
- **Hosted control plane**
  Stores pairing state, prompts, replies, commands, and attachments.
- **OpenClaw plugin**
  Connects OpenClaw to the control plane and exposes `zhihand_*` tools.

Related implementation repos:

- [Android app repository](https://github.com/handgpt/zhihand-android)
- [iOS app repository](https://github.com/handgpt/zhihand-ios)
- [ZhiHand server repository](https://github.com/handgpt/zhihand-server)

## Hosted By Default

The public onboarding path is hosted by default:

- the mobile app uses the official hosted endpoints
- the OpenClaw plugin points to the official hosted control plane
- self-hosting is optional and should stay out of the first-run path

## Upgrades And Version Pinning

For installed plugins, the standard host-side update command is:

```bash
openclaw plugins update zhihand
```

This remains the correct update command even if the first install used the npm compatibility package, because the runtime plugin id is still `zhihand`.

If you need a pinned first install, or you removed the extension directory and are reinstalling, install the exact published version:

```bash
openclaw plugins install clawhub:zhihand@<version>
```

Compatibility npm fallback:

```bash
openclaw plugins install @zhihand/openclaw@<version>
```

The pinned `install` form is create-only. For an already installed plugin, use `openclaw plugins update zhihand`.

## For Advanced Users

Advanced users can still self-host by overriding the control-plane endpoint.

That is an advanced deployment path, not the default onboarding path.

## Discovery

Recommended discovery paths:

- this repository README
- the plugin README
- the ClawHub listing
- the npm compatibility package page
- OpenClawDir or another community plugin directory

Do not assume every OpenClaw deployment has a built-in plugin-store UI.

## Maintainer Publish Path

ClawHub publication for the OpenClaw adapter uses the simple package name `zhihand`, while npm remains the compatibility package `@zhihand/openclaw`.

From `packages/host-adapters/openclaw`, publish with:

```bash
npm run publish:clawhub -- --changelog "..."
```

The helper script rewrites the staged ClawHub package name to `zhihand`, injects the GitHub source metadata for `handgpt/zhihand`, and refuses to publish while the adapter folder is dirty. Install the CLI with `npm i -g clawhub`, run `clawhub login`, and push the commit first if you want ClawHub source-linked verification to resolve correctly.

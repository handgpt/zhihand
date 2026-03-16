# Distribution

This document describes the recommended public release shape for ZhiHand.

## Recommended Release Shape

Publish ZhiHand in three parts:

1. Android app
2. hosted control plane
3. OpenClaw plugin package

Do not make the OpenClaw plugin the only product surface.

## OpenClaw Distribution

Recommended primary path:

- publish the plugin as an npm package
- install it with the official OpenClaw plugin installer

Target install command:

```bash
openclaw plugins install @handgpt/zhihand
```

Recommended discovery paths:

- the package README
- OpenClawDir or another community plugin directory
- future external catalogs if the OpenClaw deployment uses them

Do not assume a first-party plugin store UI is available everywhere.

## Hosted Vs Self-Hosted

Recommended first release:

- Android app uses the official hosted pairing and control-plane endpoints
- OpenClaw plugin defaults to the official hosted control plane
- users do not self-host the server on first install

Advanced self-hosting remains possible by overriding the control-plane endpoint.

## Other Host Runtimes

For non-OpenClaw "claw-like" hosts:

- keep the public control-plane contract stable
- expose thin host adapters instead of copying the whole OpenClaw plugin
- do not couple the public contract to OpenClaw-only runtime details

## User Flow

1. Install the ZhiHand Android app.
2. Install the OpenClaw plugin.
3. Restart or reload OpenClaw if required by the host.
4. Run `/zhihand pair`.
5. Scan the QR code from the Android app.
6. Connect `ZhiHand Device`.
7. When needed, connect `Eye` by granting screen sharing.
8. Start sending requests from the Android app or from OpenClaw.

## Module Boundary

The OpenClaw plugin should stay thin:

- pairing
- control-plane polling
- `zhihand_*` tools
- native OpenClaw agent relay

The plugin should not become its own planner or a second control plane.

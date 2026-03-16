# Archived Production Note

This document records an earlier Phase 1 production direction for ZhiHand.

It is retained as historical design context only.

## Status

Archived historical proposal. Do not treat this file as the current production
architecture.

## Current Production Shape

The current live product shape is:

- Android app connects to the hosted control plane
- OpenClaw connects to the hosted control plane
- `pair.zhihand.com` is the canonical browser-first QR landing page
- `api.zhihand.com` is the control-plane endpoint used by both the app and the
  OpenClaw adapter

For current public guidance, use:

- [README.md](./README.md)
- [docs/CONFIGURATION.md](./docs/CONFIGURATION.md)
- [docs/DISTRIBUTION.md](./docs/DISTRIBUTION.md)

## Historical Tunnel Direction

An earlier Phase 1 concept assumed:

- app-to-adapter connectivity through Cloudflare Tunnel
- per-host `<edge-id>.edge.zhihand.com` endpoints on the live path
- the hosted control plane limited to provisioning and lifecycle support

That is not the default architecture of the currently implemented product.

## Why This File Still Exists

This archive is kept because the historical tunnel design may still inform:

- future optional edge-host modes
- self-hosted or low-latency deployment experiments
- naming conventions such as `edge-id`

Any future reintroduction of a tunnel-based live path should be documented as a
new production design revision instead of silently reusing this archived note.

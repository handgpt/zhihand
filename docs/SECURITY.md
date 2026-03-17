# ZhiHand Security Notes

This document describes the current public-repo security boundary. It is not a substitute for a full product security review.

## Public Core

### `zhihandd`

- the reference service now supports optional bearer-token protection through `ZHIHAND_AUTH_TOKEN`
- `healthz` stays unauthenticated
- all `/v1/*` routes should be treated as protected when the token is configured

### OpenClaw adapter

- persists local pairing state on disk
- uses controller tokens to call control-plane endpoints
- should be deployed on hosts with local filesystem protection

## Device Runtime

### ZhiHand Device firmware

- currently uses BLE bonding with `ESP_LE_AUTH_BOND`
- still uses `ESP_IO_CAP_NONE`, which means Just Works pairing rather than strong MITM protection
- protects command execution and OTA behind the lease mechanism

## Current Gaps

- the public reference service is not the same as the private hosted production control plane
- the firmware pairing model is still weaker than a high-assurance control device would ideally use
- the overall product still needs an end-to-end security review across mobile runtime, hosted control plane, and device firmware

## Publishing Rule

Public documentation and example configs must never include:

- real tokens
- real operator credentials
- private deployment hostnames
- production certificates or private keys

# ZhiHand Action Model

## Purpose

An action is the shared unit of intent inside ZhiHand. Actions let different runtimes request, observe, and reason about behavior using one model.

The exact wire representation belongs in `control.proto`.

## Why Actions Exist

The workspace contains separate repositories for iOS, Android, Web, hardware, and core services. Without a shared action model, each runtime would encode intent differently.

Actions give the system a stable vocabulary for:

- Commanding behavior (tap, swipe, type, scroll, system navigation)
- Reporting state transitions (online, offline, profile updated)
- Describing execution lifecycle (queued, acked, completed, failed)
- Returning results (screenshots, command ACK with result data)
- Coordinating plugin and service integrations

## Current Actions

### Control Actions (`zhihand_control`)

click, doubleclick, longclick, type, swipe, scroll, keycombo, back, home, enter, open_app, clipboard, wait, screenshot

### System Actions (`zhihand_system`)

home, back, recents, notifications, quick_settings, volume_up, volume_down, volume_mute, brightness_up, brightness_down, rotate, dnd, wifi, bluetooth, flashlight, airplane, split_screen, pip, power_menu, lock_screen

### Device Events (WebSocket)

device.online, device.offline, device_profile.updated, command.acked, credential.added, credential.removed, prompt.queued, prompt.snapshot

## Action Principles

- **Intent Over UI**: Actions describe what the system wants to do, not how a specific screen expresses it
- **Shared Semantics**: Multiple runtimes reuse the same action concepts
- **Observable Lifecycle**: Actions support clear lifecycle transitions (queued, acked, completed, failed)
- **Capability-Aware**: Not every runtime supports every action; capabilities are negotiated

## Action Lifecycle

1. Action requested (command enqueued)
2. Action accepted (command delivered to device)
3. Action executed (device performs the action)
4. Action acked (device sends ACK with result)
5. Action completed (result returned to caller)

Failures: validation error, unsupported capability, permission failure, execution failure, timeout, cancellation.

## Cross-Repo Rule

All runtime categories should align to the same action model: core, host adapters, mobile apps, device runtimes. New actions should be defined here first, then adopted downstream.

## Source of Truth

Canonical wire-level representation: `proto/zhihand/control/v1/control.proto`

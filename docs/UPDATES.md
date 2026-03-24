# Update Delivery

This page explains how ZhiHand updates reach real users, and what a normal user actually needs to care about.

## What Normal Users Need To Know

ZhiHand has three different update surfaces:

- **OpenClaw plugin**
  Updated on the host with `openclaw plugins update zhihand`.
- **Android app**
  Updated from an app manifest and APK download flow.
- **Device firmware**
  Updated by the mobile app when `ZhiHand Device` is connected.

The normal first-time install path is still:

```bash
openclaw plugins install clawhub:zhihand
```

If ClawHub is temporarily unavailable or rate-limited, use the npm compatibility package:

```bash
openclaw plugins install @zhihand/openclaw
```

For an already installed plugin, use:

```bash
openclaw plugins update zhihand
```

## Update Goals

- Keep Android app updates and device firmware updates discoverable from stable, machine-readable manifests.
- Keep OpenClaw plugin upgrades predictable for operators and ordinary users.
- Separate control-plane APIs from large immutable update artifacts.
- Make update checks cheap, cache-friendly, and channel-aware.
- Ensure every installable artifact is integrity-checked before use.

## Update Roles

- `zhihand-server`
  Coordinates pairing, prompts, replies, commands, and screen snapshots.
  It does not need to serve release binaries in the long term.
- Static update host
  Serves immutable APK and firmware binaries plus small JSON manifests.
  Best practice is object storage plus CDN. Phase 1 can use nginx static hosting.
- Android app
  Polls manifests, downloads artifacts, verifies checksums, and installs or flashes updates.
- Firmware
  Exposes current hardware and firmware versions over BLE.
  Accepts OTA binaries only after the app has verified the manifest and artifact integrity.

## Plugin Update Rules

- Preferred first install: `openclaw plugins install clawhub:zhihand`
- Compatibility first install: `openclaw plugins install @zhihand/openclaw`
- Installed plugin update: `openclaw plugins update zhihand`
- Pinned first install or reinstall after deletion: `openclaw plugins install clawhub:zhihand@<version>`
- Pinned npm fallback: `openclaw plugins install @zhihand/openclaw@<version>`

The `install ...@<version>` form is for create-only scenarios. For a plugin that is already installed, the best-practice command is `openclaw plugins update zhihand`.

## Production Storage Model

Recommended public layout:

```text
https://updates.zhihand.com/android/stable.json
https://updates.zhihand.com/android/beta.json
https://updates.zhihand.com/android/zhihand-0.16.2-1602.apk
https://updates.zhihand.com/device/stable.json
https://updates.zhihand.com/device/beta.json
https://updates.zhihand.com/device/zhihand-device-1.0.1.bin
```

Rules:

- Manifests stay mutable and small.
- APK and firmware binaries are immutable.
- Artifact filenames include the final version.
- CDN caching is allowed for binaries; manifests should use a short TTL.

## Update Detection

### Android app

- Check on explicit user request from the `Updates` menu.
- Optionally refresh once per app foreground session with a cooldown.
- Compare `versionCode`, not `versionName`.
- Use the same download URL for every device on the same channel.

### Device firmware

- Check only when `ZhiHand Device` is connected and version metadata is readable.
- Match the manifest `hardware_version` against the device-reported hardware version.
- Compare semantic firmware versions, for example `1.0.1 > 1.0.0`.
- Block firmware install while a task is running. Screen sharing may stay active if the BLE OTA path is otherwise idle and ready.

## Manifest Contract

### Android

```json
{
  "version_code": 1602,
  "version_name": "0.16.2",
  "apk_url": "https://updates.zhihand.com/android/zhihand-0.16.2-1602.apk",
  "sha256": "…",
  "release_notes": ["…"],
  "published_at": "2026-03-16T00:00:00Z",
  "mandatory": false
}
```

### Device firmware

```json
{
  "hardware_version": "0.1",
  "firmware_version": "1.0.1",
  "binary_url": "https://updates.zhihand.com/device/zhihand-device-1.0.1.bin",
  "sha256": "…",
  "release_notes": ["…"],
  "published_at": "2026-03-16T00:00:00Z"
}
```

## Integrity And Authenticity

Current implementation verifies SHA-256 after download.

Production best practice should add manifest authenticity:

- Sign manifests offline.
- Embed the public verification key in the app.
- Reject unsigned or incorrectly signed manifests before download.

HTTPS plus checksum is sufficient for Phase 1 testing, but not the final trust model.

## Rollout Model

- `stable`
  Default channel for users.
- `beta`
  Opt-in channel for faster validation.
- `internal`
  Optional debug or testing channel used by development builds.

Recommended rollout order:

1. Internal
2. Beta
3. Stable

Never mutate an already published artifact in place.

## App Update Flow

1. Fetch manifest.
2. Compare with installed `versionCode`.
3. Download APK to app-managed storage.
4. Verify checksum.
5. Hand off installation to the platform installer.

## Firmware Update Flow

1. Read current hardware and firmware versions over BLE.
2. Fetch manifest.
3. Confirm hardware compatibility and newer firmware version.
4. Download firmware binary to app cache.
5. Verify checksum.
6. Pause paired-host event execution and command handling.
7. Transfer the binary over BLE OTA.
8. Wait for device reboot and re-read the reported version.

## Testing And Debug Builds

Debug builds may override update manifest URLs to a temporary host such as:

```text
https://api.zhihand.com/updates/android-stable.json
https://api.zhihand.com/updates/device-stable.json
```

Keep these overrides debug-only. Release builds should point at the production update host.

## Follow-up Best-Practice Work

- Move ESP32 OTA flash writes out of the GATT callback thread into a dedicated worker task.
- Add manifest signing.
- Support resumable artifact downloads for large APK or firmware packages.
- Add release-channel selection to Android settings when beta rollout begins.

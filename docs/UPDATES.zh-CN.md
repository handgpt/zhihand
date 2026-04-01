# 更新分发

本文定义智手®（ZhiHand）的升级探测、存放与发布机制建议。

## MCP Server 与 CLI 更新

统一的 MCP Server (`@zhihand/mcp`) 和 `zhihand` CLI 通过 **npm** 分发。

### 更新探测

默认情况下，`zhihand` CLI 会定期或根据请求检查更新：

- `zhihand update --check`: 在 npm 上执行最新版本的全新查找，而不进行安装。
- 自动检查: CLI 可能会在启动期间执行后台检查（可配置）。

### 执行更新

用户可以使用标准的 npm 命令或内置的更新实用程序来更新包：

- **手动更新**:
  ```bash
  npm install -g @zhihand/mcp
  ```
- **CLI 引导更新**:
  ```bash
  zhihand update
  ```
  该命令将检查更新、询问确认、执行安装，并重启任何已管理的系统服务（如果通过 `zhihand service install` 安装）。

### 回滚

如果新版本出现问题，CLI 支持回滚到上一个版本：

- `zhihand update --rollback`: 回退到之前安装的包版本。

## 目标

- 让 Android App 升级与设备固件升级都通过稳定、机器可读的 manifest 探测。
- 将控制面 API 与大体积升级包解耦。
- 让升级检查足够轻量、可缓存，并支持分渠道发布。
- 在安装或刷写前，对每个升级包做完整性校验。

## 职责边界

- `zhihand-server`
  - 负责 pairing、prompt、reply、command、screen 等控制面状态。
  - 长期不建议承担升级包分发主角色。
- 静态更新源
  - 提供不可变 APK、固件二进制和小型 JSON manifest。
  - 最佳实践是对象存储 + CDN；Phase 1 可以先用 nginx 静态托管。
- Android App
  - 拉取 manifest、下载升级包、校验、安装或刷写。
- 固件
  - 通过 BLE 暴露当前硬件版本和固件版本。
  - 只接收经过 App 校验的 OTA 二进制。

## 生产环境存放模型

推荐公开目录结构：

```text
https://updates.zhihand.com/android/stable.json
https://updates.zhihand.com/android/beta.json
https://updates.zhihand.com/android/zhihand-0.16.2-1602.apk
https://updates.zhihand.com/device/stable.json
https://updates.zhihand.com/device/beta.json
https://updates.zhihand.com/device/zhihand-device-1.0.1.bin
```

规则：

- manifest 可变、体积小。
- APK 和固件包必须不可变。
- 升级包文件名中直接带最终版本号。
- 二进制可长缓存，manifest 使用短缓存 TTL。

## 升级探测

### Android App

- 在 `Updates` 菜单中由用户显式触发检查。
- 可选：每次前台启动只做一次带冷却时间的轻量刷新。
- 以 `versionCode` 为准，不以 `versionName` 为准。
- 同一渠道的所有设备共享同一个 APK 地址。

### 设备固件

- 仅在 `ZhiHand Device` 已连接且可读到版本信息时检查。
- 先匹配 manifest 的 `hardware_version` 与设备上报的硬件版本。
- 使用语义版本比较，例如 `1.0.1 > 1.0.0`。
- 任务运行中或录屏进行中禁止发起固件升级。

## Manifest 结构

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

### 设备固件

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

## 完整性与真实性

当前实现已经支持下载后的 SHA-256 校验。

生产最佳实践还应补上 manifest 真实性校验：

- 使用离线密钥对 manifest 签名。
- 在 App 中内置公钥。
- 对未签名或签名错误的 manifest 直接拒绝。

仅靠 HTTPS + checksum 足够完成 Phase 1 测试，但不是最终信任模型。

## 发布渠道

- `stable`
  - 默认用户渠道。
- `beta`
  - 自愿加入的测试渠道。
- `internal`
  - 开发和联调用渠道。

建议发布顺序：

1. Internal
2. Beta
3. Stable

已经发布的升级包不得原地替换。

## App 升级流程

1. 拉取 manifest。
2. 与本地 `versionCode` 比较。
3. 将 APK 下载到 app 可管理目录。
4. 校验 checksum。
5. 交给系统安装器安装。

## 固件升级流程

1. 通过 BLE 读取当前硬件版本和固件版本。
2. 拉取 manifest。
3. 确认硬件兼容且固件确实更新。
4. 将固件包下载到 app cache。
5. 校验 checksum。
6. 暂停 paired-host 轮询和任务执行。
7. 通过 BLE OTA 发送固件。
8. 等待设备重启，并重新读取版本确认结果。

## 调试与测试

Debug 构建可以将更新源覆盖到临时地址，例如：

```text
https://api.zhihand.com/updates/android-stable.json
https://api.zhihand.com/updates/device-stable.json
```

这类覆盖必须只存在于 debug 构建；release 仍应指向正式更新源。

## 后续最佳实践工作

- 将 ESP32 OTA 写 flash 从 GATT callback 线程迁移到独立 worker task。
- 补齐 manifest 签名。
- 为大 APK/固件包补充断点续传。
- 当 beta 渠道启用后，在 Android 设置中加入渠道选择。

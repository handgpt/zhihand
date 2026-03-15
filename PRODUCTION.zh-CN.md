# Phase 1 生产设计

## 决策

Phase 1 采用以下方案：

- 使用宿主适配器作为被连接端，首个实现从 OpenClaw 开始
- iOS / Android App 作为主动连接端
- 使用 Cloudflare Tunnel 提供可达性
- 使用二维码完成配对引导与信任建立

Phase 1 **不**在实时数据路径上使用自建中继服务。

## 准确定义

这**不是**“永远没有后端”。

它的准确含义是：

- 实时控制链路上没有自建中继
- 宿主适配器本地服务通过 Cloudflare Tunnel 暴露
- 可选的部署控制面位于公共仓库之外，用于发放、清理、撤销和设备生命周期管理

## 核心角色

### 宿主适配器

- 负责 Tunnel 后面的本地 HTTPS / WSS 服务
- 负责配对状态
- 负责每个 App 的长期凭据
- 负责权限授予
- 负责会话租约和过期清理

首个生产适配器从 OpenClaw 开始，未来可以扩展到 Codex、Claude Code 等宿主环境。

### 移动 App

- 扫描二维码
- 确认适配器身份
- 主动发起连接
- 将长期凭据存入 Keychain / Android Keystore
- 仅在对应硬件能力可用时执行 BLE 相关操作

### Cloudflare

- 通过 Tunnel 提供适配器的公网可达性
- 不作为 App 配对的信任来源
- 不作为长期应用凭据的存储方

### 部署控制面

- 可以负责配对会话签发
- 可以负责不透明 `edge-id` 分配
- 可以负责 tunnel 与 hostname 生命周期
- 可以负责 App / 适配器名册和撤销流程
- Phase 1 默认不需要位于实时命令路径上

### BLE 硬件

- 与适配器配对属于不同信任域
- 不应自动继承高风险权限

## 域名规划

- `zhihand.com`
  品牌与总入口
- `pair.zhihand.com`
  二维码入口域名，用于 Universal Link / App Link
- `<edge-id>.edge.zhihand.com`
  每个适配器实例的生产访问地址
- `api.zhihand.com`
  预留给未来 provisioning 与生命周期管理
- `relay.zhihand.com`
  预留给未来中继模式

## Endpoint 命名规则

- `edge-id` 必须是随机且不可推断的
- 不允许使用用户名、邮箱、设备名、硬件序列号
- 推荐使用 10 到 12 位 Crockford Base32

示例：

`k7m2p4t9xq.edge.zhihand.com`

## 生产约束

- 不允许在移动 App 中内置长期 Cloudflare service token
- 不允许适配器主动连入 App
- 不假设移动 App 可以稳定充当后台服务端
- 不假设 BLE 控制永远可用
- 不允许用户自定义公网 hostname

## 为什么部署控制面仍可能存在

即使 Phase 1 的实时链路是 App 通过 Cloudflare Tunnel 直接连接适配器，部署控制面仍可能有价值。

它可以负责：

- 配对会话签发
- endpoint 命名
- tunnel 发放与清理
- 名册元数据
- 凭据撤销

这些能力被明确视为部署专属能力，因此不放在这个公共仓库中。

## 二维码格式

二维码必须编码为 HTTPS 链接，而不是裸 JSON，也不能只用自定义 scheme。

推荐格式：

`https://pair.zhihand.com/p/1?d=<base64url_payload>`

Payload 建议包含：

- `v`
- `mode = cf_tunnel`
- `edge_host`
- `pair_session_id`
- `pair_token`
- `exp`
- `adapter_name`
- `adapter_pubkey`
- `adapter_fingerprint`
- `requested_scopes`
- `protocol_min`
- `protocol_max`

## 配对流程

1. 适配器确认 Tunnel 在线。
2. 适配器打开一个短时配对窗口。
3. 适配器生成：
   - 单次使用的配对 token
   - 短时有效的配对密钥对
   - 过期时间
   - 配对会话 ID
   - 必要时可向部署控制面请求签名后的配对会话
4. 适配器渲染二维码。
5. App 扫码后展示：
   - 适配器名称
   - 指纹后缀
   - 请求的权限
   - 过期倒计时
6. 用户在 App 中点击连接。
7. App 主动向适配器 endpoint 发起 HTTPS 连接。
8. App 发送：
   - App 实例 ID
   - App 公钥
   - 配对 token
   - 平台和 App 版本
9. 适配器通过 challenge-response 证明自己持有配对私钥。
10. 适配器侧展示二次确认步骤：
    - 明确的确认按钮，或
    - 两端同时显示的一组短校验码
11. 用户确认后，适配器向该 App 签发长期凭据。
12. App 将该凭据安全保存。
13. 适配器立即使二维码中的 token 失效。

## 长期凭据模型

采用非对称凭据模型。

- App 自行生成长期密钥对
- 私钥只保存在 Keychain / Android Keystore 中
- 适配器保存 App 公钥、元数据、权限范围和最后在线时间
- 后续重连通过签名 nonce 完成，不再使用最初二维码中的 token

## 权限模型

权限必须拆分为独立 scope：

- `observe`
- `session.control`
- `ble.control`
- `device.manage`
- `device.ota`

首次配对默认授予：

- `observe`
- `session.control`

以下权限需要额外确认：

- `ble.control`
- `device.manage`
- `device.ota`

## 传输模型

Phase 1 传输层采用：

- HTTPS 处理配对和管理接口
- WSS 处理实时控制会话

Phase 1 不把原始 gRPC 直接暴露给移动端。移动端传输模型应与共享 action model 对齐，以便未来自然映射回共享协议。

## 会话租约规则

- WebSocket 每 15 秒一次 heartbeat
- 45 秒没有 heartbeat 则视为 stale
- 适配器必须主动清理 ghost session
- 每个 App 实例只允许一个前台控制会话

## 移动端规则

### iOS

- 不依赖长期后台 socket
- 交互控制默认要求 App 在前台
- 二维码入口应支持 Universal Links
- 相机权限只在扫码时申请
- 蓝牙权限只在进入 BLE 能力时申请

### Android

- App 仍然是主动连接端
- 为了稳定性，交互控制也默认要求前台
- 二维码入口应支持 App Links
- 蓝牙权限按需懒申请

## BLE 规则

- App 与适配器配对，不代表自动获得硬件控制权限
- Phase 1 默认由 App 持有 BLE 主控制权
- 适配器发送的是意图级命令，而不是长期的远程 HID 原始流
- OTA、重置、重配网等高风险操作必须二次确认

## Cloudflare 规则

- 每个适配器实例对应一个 named tunnel
- 每个适配器实例对应一个公网 hostname
- 生产环境不允许使用 `trycloudflare.com`
- tunnel 发放可以从手工开始，但未来可以交给部署专属基础设施管理

## Phase 1 明确不做的事

- 不做跨 NAT 的 adapter-to-app 直连 P2P
- 不把 Cloudflare WARP 作为默认接入方案
- 不在首个生产版本中实现 mDNS / 同局域网快速路径
- 不在实时路径上引入自建中继

## 延后但已规划

### Phase 1.5

- 可选的同局域网优化
- 在 tunnel 信任建立后，支持可选的本地路径升级

### Phase 2

- 在 `api.zhihand.com` 上引入最小部署控制面
- 自动化 tunnel 发放
- DNS 生命周期清理
- 撤销与名册管理
- hostname 轮换

### Phase 3

- 在 `relay.zhihand.com` 上提供中继模式
- 更完整的策略与审计
- 多适配器 / 多设备编排

## Gemini 复核结论

Gemini 认可 Cloudflare-first 作为 Phase 1 的总体方向，同时指出了 4 个必须纳入生产设计的问题，这些已经吸收到本文档中：

- endpoint 命名必须随机且不可推断
- 首次配对必须增加适配器侧确认
- 必须用会话租约和超时清理处理 ghost session
- 需要尽早为最小控制面预留位置

Gemini 还建议增加同局域网 fallback。这个建议没有被否定，而是被明确延后。原因是首个生产版本应优先保证 tunnel 路径稳定，避免同时引入本地发现、额外移动端权限和双路径调试复杂度。

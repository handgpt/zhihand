# 公共配置面

本文档记录 ZhiHand 公共仓库中允许公开的配置面。

它的目标是：

- 让后续实现或联调时不需要重新翻代码找字段
- 保持公共仓库可开源
- 明确哪些信息绝对不能写进公共仓库

以下内容**不得**写入本仓库：

- 真实 token、密码、Cookie、API Key
- 私有服务器地址、SSH 入口、测试机名
- 某一台机器专属的绝对路径
- 运维口令、Basic Auth、Gateway token

## 公开域名类别

公共模型假设以下几类域名：

- `pair.zhihand.com`
  二维码落地页与移动端 claim 引导
- `api.zhihand.com`
  部署控制面的基准地址
- `<edge-id>.edge.zhihand.com`
  每个宿主实例的公开身份地址

这里记录的是“类别”和“命名规则”，不是某一台机器的实际部署信息。

## OpenClaw 插件配置

公共 OpenClaw 插件使用 `plugins.entries.zhihand.config` 这组配置字段：

- `controlPlaneEndpoint`
  控制面基地址，例如 `https://api.zhihand.com`
- `originListener`
  当前宿主实例的公开来源标识，例如 `https://host.example.zhihand.com`
- `displayName`
  配对界面里展示的人类可读名称
- `stableIdentity`
  稳定插件身份，用于跨重启复用同一个 `edge-id`
- `pairingTTLSeconds`
  二维码有效期，最小 `30`
- `appDownloadURL`
  生成配对信息时展示给用户的 App 下载地址
- `gatewayResponsesEndpoint`
  薄插件转发到本地 OpenClaw `POST /v1/responses` 的地址
- `gatewayAuthToken`
  调用本地 OpenClaw `POST /v1/responses` 时使用的 Gateway Bearer Token
- `mobileAgentId`
  专用于 ZhiHand 手机提示词的 OpenClaw agent id
- `requestedScopes`
  写入配对描述符中的权限申请列表

其中必须显式提供：

- `controlPlaneEndpoint`
- `originListener`

公开安全的示例：

```json
{
  "plugins": {
    "entries": {
      "zhihand": {
        "enabled": true,
        "config": {
          "controlPlaneEndpoint": "https://api.zhihand.com",
          "originListener": "https://host.example.zhihand.com",
          "displayName": "ZhiHand @ example-host",
          "stableIdentity": "openclaw-zhihand:example-host",
          "pairingTTLSeconds": 600,
          "appDownloadURL": "https://zhihand.com/download",
          "gatewayResponsesEndpoint": "http://127.0.0.1:18789/v1/responses",
          "gatewayAuthToken": "set-this-in-deployment",
          "mobileAgentId": "zhihand-mobile",
          "requestedScopes": [
            "observe",
            "session.control",
            "ble.control"
          ]
        }
      }
    }
  }
}
```

示例里只能使用占位值或可公开域名，不能填真实凭据。

公共插件不会默认绑定某一个私有控制面实例。
部署方必须显式提供控制面地址和宿主来源标识。

## OpenClaw 运行时最佳实践

公共 ZhiHand 插件应该保持“薄”。

推荐的运行时分工：

- 插件：配对、轮询、控制面传输、`zhihand_*` 工具
- OpenClaw agent/runtime：提示词推理、工具编排、最终回复

不要把“插件内自带 planner”或“直接 `codex exec` 编排”当成公共契约。
那只是实现绕路，不是目标架构。

推荐的专用 agent 例子：

```json
{
  "agents": {
    "list": [
      {
        "id": "zhihand-mobile",
        "model": "openai-codex/gpt-5.4",
        "tools": {
          "allow": ["zhihand"]
        }
      }
    ]
  }
}
```

原因：

- OpenClaw 插件文档把 agent tools 定义为正常的 LLM 集成点
- OpenClaw CLI backend 文档把 `codex-cli/*` 定义成 text-only fallback，
  tools 默认不可用
- 使用原生 `POST /v1/responses` 可以把策略、审计、工具边界都留在
  OpenClaw 运行时里

落实这套最佳实践时，部署需要满足：

- `gateway.http.endpoints.responses.enabled = true`
- 插件能拿到本地 gateway bearer token
- 专用的 ZhiHand mobile agent 使用支持 tools 的 provider model，例如
  `openai-codex/gpt-5.4`
- `zhihand_*` 工具注册为 optional，并且只对白名单中的专用 agent 开放
- 如果缺少这些前提，relay 不会启动，并会在启动阶段直接记录配置错误

## OpenClaw 侧命令与工具

公共 OpenClaw 适配器暴露以下入口：

- slash commands
  - `/zhihand pair`
  - `/zhihand status`
  - `/zhihand unpair`
- tools
  - `zhihand_pair`
  - `zhihand_status`
  - `zhihand_screen_read`
  - `zhihand_control`

`zhihand_control` 当前支持的动作值：

- `click`
- `long_click`
- `move`
- `move_to`
- `swipe`
- `back`
- `home`
- `enter`
- `input_text`
- `open_app`
- `set_clipboard`
- `start_live_capture`
- `stop_live_capture`

坐标最佳实践：

- `click`、`long_click`、`move_to` 使用基于最新 `zhihand_screen_read`
  图像的 `xRatio`、`yRatio`，范围都是 `[0,1]`。
- `swipe` 使用 `[0,1]` 范围内的
  `x1Ratio`、`y1Ratio`、`x2Ratio`、`y2Ratio`。
- `move` 使用 `[-1,1]` 范围内的 `dxRatio`、`dyRatio` 作为相对位移。
- 公共调用方不应再传原始截图像素坐标。
- 如果最新截图已经过旧，`zhihand_screen_read` 应直接失败，而不是让
  agent 继续拿旧图做视觉点击。
- 如果 Android 键盘已经弹出，而下一步是提交搜索、发送或确认文本，
  应优先使用 `enter`，不要再点输入法右下角动作键。
- `input_text` 支持 `mode`：
  - `auto`：当前默认值，在 Android 端会解析成 paste-first
  - `paste`：先写剪贴板，再通过 HID 发送粘贴快捷键
  - `type`：逐字 HID 键入，只用于敏感字段或目标控件拒绝粘贴时
- `input_text` 支持 `submit=true`，表示文本输入成功后立刻补一个 `Enter`。
- `auto` 和 `paste` 会覆盖 Android 当前系统剪贴板，这是为了输入稳定性做出的
  取舍。敏感文本或不允许改写剪贴板时，应优先使用 `type`。

## 配对描述符字段

二维码落地页返回的公共字段包括：

- `v`
- `mode`
- `control_plane_host`
- `edge_id`
- `edge_host`
- `pair_session_id`
- `pair_token`
- `expires_at`
- `requested_scopes`

这组字段只负责“引导配对”。
它不是长期凭据，也不能替代后续 claim 后签发的 credential。

## Android 公共集成预期

公共模型默认 Android App 完成以下动作：

- 扫二维码或打开配对链接
- 从 `pair.zhihand.com` 解析配对描述符
- 向控制面 claim 对应 pairing session
- 在本地持久化长期凭据
- 通过控制面轮询 paired-host 命令
- 在录屏有效时，向控制面上传最新屏幕快照

## BLE 租约约定

Android App 与 ZhiHand 硬件之间使用 BLE 租约机制，保证多设备竞争时只有一个有效控制端。

当前公共常量：

- 指令服务 UUID：`0x1815`
- 指令特征 UUID：`0x2A56`
- 租约特征 UUID：`0xFF02`

公共租约操作：

- `claim`
- `renew`
- `release`

公共状态/结果：

- `free`
- `leased`
- `granted`
- `renewed`
- `busy`
- `expired`

## 读屏约束

远程读屏依赖 Android App 当前已经持有有效的本地录屏会话。

公共模型**不**假设远程命令可以静默绕过 Android 的 `MediaProjection` 权限。

因此当前行为是：

- `zhihand_screen_read` 读取的是“最近一次上传的快照”
- `zhihand.start_live_capture` 可能返回需要本地授权的结果
- 真正开始读屏前，用户仍可能需要先在 App 里手动开启录屏

## 公共状态文件

OpenClaw 插件在其状态目录下使用以下相对路径：

- `plugins/zhihand/state.json`
- `plugins/zhihand/latest-screen.jpg`

本公共仓库只记录相对路径和文件语义，不记录某一台部署机器上的绝对路径。

## 发布规则

如果某个配置项包含以下任一内容，它就不应该进入本公共仓库：

- 秘密值
- 私有基础设施地址
- 运维账号
- 部署密码
- 只适用于单台机器的 token 文件路径

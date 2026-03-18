# 智手®（ZhiHand）配置说明

说明：智手®是 ZhiHand 的中文名称；ZhiHand 由 HandGPT 更名而来。文档中的域名、包名、命令与代码标识保持英文。

这份文档说明：

- 大多数用户实际需要配置什么
- 进阶用户还能覆盖什么
- 哪些内容绝不能写进公共仓库

## 大多数用户

如果你使用官方托管默认值，大多数用户只需要两步：

1. 安装 Android App
2. 安装 OpenClaw 插件

正式安装命令：

```bash
openclaw plugins install @zhihand/openclaw
```

然后把插件 id 加进 OpenClaw allowlist：

```bash
openclaw config set plugins.allow '["openclaw"]' --strict-json
```

然后执行：

```text
/zhihand pair
```

在默认托管路径下，插件已经默认使用：

- `https://pair.zhihand.com`
- `https://api.zhihand.com`
- `https://zhihand.com/download`

如果你还需要查看 Android App 或 server 的说明，请直接看：

- [zhihand-android](https://github.com/handgpt/zhihand-android)
  查看 Android 侧行为、权限和移动端设置
- [zhihand-ios](https://github.com/handgpt/zhihand-ios)
  查看 iPhone/iPad 侧行为和 iOS 传输细节
- [zhihand-server](https://github.com/handgpt/zhihand-server)
  查看控制面部署和服务端配置

## 用户实际会看到什么

### 在 OpenClaw 中

插件会提供：

- `/zhihand pair`
- `/zhihand status`
- `/zhihand unpair`
- `/zhihand update`
- `/zhihand update check`

### 在移动端 App 中

App 负责：

- 扫配对二维码
- claim 配对关系
- 本地保存长期凭据
- 在录屏开启时上传屏幕快照
- 上传设备画像，便于宿主按 ROM / 机型 / 运行时特征做策略适配
- 上传提示词与附件
- 通过 SSE 接收命令与回复，再执行设备侧动作

## OpenClaw 进阶配置

进阶用户或自托管用户，可以在下面这组配置里覆盖默认值：

```json
{
  "plugins": {
    "entries": {
      "openclaw": {
        "enabled": true,
        "config": {}
      }
    }
  }
}
```

公开配置字段包括：

- `controlPlaneEndpoint`
  控制面地址。
  默认值：`https://api.zhihand.com`
- `originListener`
  可选的宿主公开来源标识
- `displayName`
  配对时给用户看的名称
- `stableIdentity`
  跨重启保持同一个 `edge-id` 的稳定身份
- `pairingTTLSeconds`
  二维码有效期
- `appDownloadURL`
  配对输出中展示的 App 下载地址
- `gatewayResponsesEndpoint`
  本地 OpenClaw `POST /v1/responses` 地址
- `gatewayAuthToken`
  调用本地 OpenClaw 时使用的 Bearer Token
- `mobileAgentId`
  专门处理手机提示词的 OpenClaw agent id
- `updateCheckEnabled`
  是否在启动时自动检查 npm 已发布更新
- `updateCheckIntervalHours`
  两次自动 npm 更新检查之间的最小小时数
- `requestedScopes`
  写进配对描述符的权限申请列表

公开安全的示例：

```json
{
  "plugins": {
    "allow": ["openclaw"],
    "entries": {
      "openclaw": {
        "enabled": true,
        "config": {
          "gatewayAuthToken": "set-this-in-deployment"
        }
      }
    }
  }
}
```

如果你不想手动编辑 `~/.openclaw/openclaw.json`，也可以直接用 CLI 写入 allowlist：

```bash
openclaw config set plugins.allow '["openclaw"]' --strict-json
```

这样做是推荐的，因为当非内置插件安装完成后，如果 `plugins.allow` 为空，OpenClaw 会发出 warning。

插件默认也会在启动时检查 npm 是否有新的已发布版本。
可以用 `/zhihand update check` 强制刷新检查结果，或用 `/zhihand update` 安装最新发布版本，然后重新加载 OpenClaw。

## 官方托管默认值

公共插件默认使用：

- `controlPlaneEndpoint`: `https://api.zhihand.com`
- `pairingTTLSeconds`: `600`
- `appDownloadURL`: `https://zhihand.com/download`
- `gatewayResponsesEndpoint`: `http://127.0.0.1:18789/v1/responses`
- `mobileAgentId`: `zhihand-mobile`
- `updateCheckEnabled`: `true`
- `updateCheckIntervalHours`: `24`

这些默认值就是面向普通用户的官方托管路径。

## OpenClaw 运行时最佳实践

插件应保持“薄”。

推荐分工：

- **插件**
  负责配对、控制面传输、SSE 事件接入与 `zhihand_*` 工具
- **OpenClaw agent**
  负责推理、工具编排与最终回复

不要把插件内 planner 或直接 `codex exec` 流程当成公共契约。

推荐的专用 agent 例子：

```json
{
  "agents": {
    "list": [
      {
        "id": "zhihand-mobile",
        "model": "openai-codex/gpt-5.4",
        "tools": {
          "allow": ["openclaw"]
        }
      }
    ]
  }
}
```

## OpenClaw 工具

适配器当前暴露：

- `zhihand_pair`
- `zhihand_status`
- `zhihand_screen_read`
- `zhihand_control`

`zhihand_control` 当前支持：

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

## 提示词附件

手机提示词路径当前可携带：

- 图片
- 语音
- 文档
- 有限视频附件

推荐做法：

- 图片和文档直接作为附件上传
- 语音以原始音频附件上传
- 音频转写由 OpenClaw 宿主完成
- 不要把“App 本地先转文字”当成公共主契约

## 配对链接行为

`https://pair.zhihand.com/pair?d=<base64url>` 现在有两种模式：

- 浏览器模式
  - 默认
  - 返回 HTML 二维码页面
- 机器模式
  - 通过 `Accept: application/json` 或 `?format=json`
  - 返回原始配对描述符 JSON

普通用户流程是：

1. OpenClaw 返回二维码链接
2. 浏览器打开二维码页面
3. Android App 扫码
4. App 以 JSON 模式解析描述符并完成 claim

## BLE 租约

智手®设备使用 BLE 租约，确保同一时刻只有一个有效附近客户端控制硬件。

公共 UUID：

- 服务：`0x1815`
- 指令特征：`0x2A56`
- 租约特征：`0xFF02`

公共操作：

- `claim`
- `renew`
- `release`

公共结果：

- `free`
- `leased`
- `granted`
- `renewed`
- `busy`
- `expired`

## 读屏约束

远程读屏依赖 Android App 已经持有有效的本地录屏会话。

公共模型不假设可以静默绕过 Android 的 `MediaProjection` 授权。

## 公共仓库安全规则

以下内容不应写入本仓库：

- 真实 token
- 真实密码
- 真实 API Key
- 私有 SSH 入口
- 运维凭据
- 机器专属内部路径

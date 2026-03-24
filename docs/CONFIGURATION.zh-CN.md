# 智手®（ZhiHand）配置说明

说明：智手®是 ZhiHand 的中文名称；ZhiHand 由 HandGPT 更名而来。文档中的域名、包名、命令与代码标识保持英文。

这份文档先解释“普通用户最少要配什么”，再解释“进阶用户还能改什么”。

## 如果你只想走官方托管路径

对大多数用户，只需要：

1. Android App
2. OpenClaw 插件
3. 把一次性的 OpenClaw gateway token 写进插件配置

推荐安装方式：

```bash
openclaw plugins install clawhub:zhihand
```

如果 ClawHub 当前不可用或遇到限流，可以改用 npm 兼容包：

```bash
openclaw plugins install @zhihand/openclaw
```

一次性托管配置：

下面这段取 token 的脚本默认宿主机上有 `python3`。如果没有，可以直接打开 `~/.openclaw/openclaw.json`，手动读取 `gateway.auth.token`。

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

然后执行：

```text
/zhihand pair
```

## 为什么这几项配置不能省

- `plugins.allow`
  告诉 OpenClaw 信任这个非内置插件 id。
- `tools.allow`
  让 `zhihand_*` 这些可选工具真正暴露给 OpenClaw 运行时。
- `gateway.http.endpoints.responses.enabled`
  打开插件转发链路依赖的本地 OpenClaw `POST /v1/responses` 路由。
- `plugins.entries.zhihand.config.gatewayAuthToken`
  给插件提供本地转发所需的 bearer token。

如果缺了它们，插件可能能装上，但配对、转发或工具执行不会真正工作。迁移期间仍兼容旧的 `openclaw` 配置键，但新安装应统一使用 `zhihand`。

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

- 扫描配对二维码
- 认领配对关系
- 本地保存长期凭据
- 在录屏开启时上传屏幕快照
- 上传设备画像，便于宿主按运行时类型做策略适配
- 上传提示词与附件
- 通过 SSE 接收命令与回复，再执行设备侧动作

## 官方托管默认值

对公共托管路径，插件默认使用：

- `https://pair.zhihand.com`
- `https://api.zhihand.com`
- `https://zhihand.com/download`
- `gatewayResponsesEndpoint`: `http://127.0.0.1:18789/v1/responses`
- `mobileAgentId`: `zhihand-mobile`
- `updateCheckEnabled`: `true`
- `updateCheckIntervalHours`: `24`

大多数用户不需要覆盖这些值。

## OpenClaw 进阶配置

进阶用户或自托管用户，可以在下面这组配置里覆盖默认值：

```json
{
  "plugins": {
    "entries": {
      "zhihand": {
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
  是否在启动时自动检查 npm 兼容包的已发布更新
- `updateCheckIntervalHours`
  两次自动 npm 兼容包更新检查之间的最小小时数
- `requestedScopes`
  写进配对描述符的权限申请列表

公开安全的最小示例：

```json
{
  "plugins": {
    "allow": ["zhihand"],
    "entries": {
      "zhihand": {
        "enabled": true,
        "config": {
          "gatewayAuthToken": "set-this-in-deployment"
        }
      }
    }
  }
}
```

CLI 等价写法：

```bash
openclaw config set plugins.allow '["zhihand"]' --strict-json
openclaw config set tools.allow '["zhihand"]' --strict-json
openclaw config set gateway.http.endpoints.responses.enabled true --strict-json
openclaw config set plugins.entries.zhihand.config.gatewayAuthToken '"your-gateway-token"' --strict-json
```

推荐的宿主侧升级命令：

```bash
openclaw plugins update zhihand
```

即使第一次安装来自 npm 兼容包，后续正确的升级命令也仍然是这条，因为运行时插件 id 依然是 `zhihand`。

`openclaw plugins install clawhub:zhihand@<version>` 只适用于首次安装或删除扩展目录后的重装。npm 兼容路径仍然是 `openclaw plugins install @zhihand/openclaw@<version>`。

## OpenClaw 运行时最佳实践

插件应该保持“薄”。

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
          "allow": ["zhihand"]
        }
      }
    ]
  }
}
```

## 普通用户通常不需要改什么

对正常托管路径，你通常不需要配置：

- 自定义 control-plane endpoint
- 自定义 App 下载地址
- 自定义 `mobileAgentId`
- 手动编辑 `~/.openclaw/openclaw.json`
- Control UI 浏览器侧的 allowed origins

如果你需要移动端或服务端细节，请看这些仓库：

- [zhihand-android](https://github.com/handgpt/zhihand-android)
- [zhihand-ios](https://github.com/handgpt/zhihand-ios)
- [zhihand-server](https://github.com/handgpt/zhihand-server)

## OpenAI Computer Tool 现状

当前推荐给 ZhiHand 移动端 agent 的模型仍然是 `openai-codex/gpt-5.4`，但这条 OpenClaw 转发路径 **并没有** 接入 OpenAI GA 版的 `computer` 工具。

当前公开集成契约是：

- 本地转发走 OpenClaw 的 `POST /v1/responses`
- OpenClaw 在这个面上目前只接收托管的 **function tools**
- 所以移动端 agent 走的是 `zhihand_screen_read` 和 `zhihand_control`

不要把这理解成已经启用了原生的 OpenAI `computer_call` 或 `computer_call_output`。如果要使用 OpenAI GA 版 computer tool，需要上游 OpenClaw 先支持该工具类型，或另做一条绕过本地 OpenClaw `/v1/responses` 的直连 OpenAI harness。而这条直连 harness 当前 **不是** ZhiHand/OpenClaw 插件的公开契约。

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
4. App 以 JSON 模式解析描述符并完成认领

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

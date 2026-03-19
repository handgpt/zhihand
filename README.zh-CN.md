# 智手®（ZhiHand）

说明：智手®是 ZhiHand 的中文名称；ZhiHand 由 HandGPT 更名而来。文档中的域名、包名、命令与代码标识保持英文。

当前核心版本：`0.9.7`

智手®让 OpenClaw 能看懂你的手机，并通过 `ZhiHand Device` 帮你操作手机。

你可以把它理解成三部分协同工作：

- `Brain`
  OpenClaw 接收你的请求，并决定下一步该做什么。
- `Eye`
  Android App 在你授权后共享当前屏幕。
- `Hand`
  智手®设备把真正的输入动作发给手机。

## 普通用户怎么用

大多数用户只需要这条流程：

1. 安装 Android App
2. 安装 OpenClaw 插件
3. 在 OpenClaw 里执行 `/zhihand pair`
4. 用 App 扫码
5. 连接 `ZhiHand Device`
6. 需要读屏时再打开 `Eye`
7. 开始直接向 OpenClaw 提需求

如果你使用官方托管默认值，首次使用时不需要先自建服务端。

## 快速开始

### OpenClaw 用户

安装插件：

```bash
openclaw plugins install @zhihand/openclaw
```

然后把插件 id 加进 OpenClaw allowlist：

```bash
openclaw config set plugins.allow '["openclaw"]' --strict-json
```

然后把智手®插件工具开放给 OpenClaw agent 运行时：

```bash
openclaw config set tools.allow '["openclaw"]' --strict-json
```

然后把当前 OpenClaw gateway token 写进插件配置：

```bash
openclaw doctor --generate-gateway-token
export ZHIHAND_GATEWAY_TOKEN="$(python3 - <<'PY'
import json
from pathlib import Path
config = json.loads((Path.home() / '.openclaw' / 'openclaw.json').read_text())
print(config['gateway']['auth']['token'])
PY
)"
openclaw config set gateway.http.endpoints.responses.enabled true --strict-json
openclaw config set plugins.entries.openclaw.config.gatewayAuthToken "\"$ZHIHAND_GATEWAY_TOKEN\"" --strict-json
```

按你的 OpenClaw 环境要求重启或重新加载后，执行：

```text
/zhihand pair
```

浏览器打开返回的二维码链接，再用 Android App 扫码。

插件默认会在启动时检查 npm 是否有新的已发布版本。
可以执行 `/zhihand update check` 查看最新发布版本，或执行 `/zhihand update` 输出推荐的宿主侧更新命令，再重新加载 OpenClaw。

推荐直接在宿主机 shell 执行：

```bash
openclaw plugins update openclaw
```

`openclaw plugins install @zhihand/openclaw@<version>` 只适用于首次安装，或者你已经删除现有扩展目录后的重装。对已经安装的插件做升级时，请使用 `openclaw plugins update openclaw`。

### Android 用户

1. 打开智手® App
2. 点击 `Scan`
3. 扫描 OpenClaw 提供的二维码
4. 连接 `ZhiHand Device`
5. 当你希望智手®看屏幕时，再点开 `Eye`

## 这三部分分别在做什么

- **移动端 App**
  负责接收用户输入、上传屏幕快照与设备画像、执行设备侧动作
- **智手® server**
  负责保存配对关系、提示词、回复、命令和附件
- **OpenClaw 插件**
  负责把 OpenClaw 接到智手®控制面，并暴露 `zhihand_*` 工具

## 这个仓库里有什么

这个仓库是智手®的公共核心仓库，主要包含：

- 公共说明文档
- 公共协议与动作模型
- OpenClaw 宿主适配器
- 参考服务边界

它不包含私有部署密钥，也不包含私有产品基础设施。

## 下一步看什么

- [DISTRIBUTION.zh-CN.md](./docs/DISTRIBUTION.zh-CN.md)
  从用户角度解释如何安装和开始使用
- [CONFIGURATION.zh-CN.md](./docs/CONFIGURATION.zh-CN.md)
  大多数用户需要什么，进阶用户还能改什么
- [UPDATES.zh-CN.md](./docs/UPDATES.zh-CN.md)
  App 与设备更新如何探测和发布
- [zhihand-android](https://github.com/handgpt/zhihand-android)
  查看 Android App、权限、配对和设备侧执行相关说明
- [zhihand-server](https://github.com/handgpt/zhihand-server)
  查看控制面部署与服务端配置说明

## 面向开发者的文档

如果你是要集成或扩展智手®，这些文档更重要：

- [ARCHITECTURE.md](./docs/ARCHITECTURE.md)
- [ACTIONS.md](./docs/ACTIONS.md)
- [PROTOCOL.md](./docs/PROTOCOL.md)
- [COMPATIBILITY.md](./docs/COMPATIBILITY.md)
- [SECURITY.md](./docs/SECURITY.md)
- [REPOSITORY.md](./docs/REPOSITORY.md)
- [CLIENT_REPOS.md](./docs/CLIENT_REPOS.md)
- [ROADMAP.zh-CN.md](./ROADMAP.zh-CN.md)

当前这个公共参考服务已实现的是：

- HTTP JSON + SSE
- 可选 Bearer Token 鉴权
- 有上限的内存事件保留

它目前还没有真正公开的 gRPC listener。

## 公开发布规则

本仓库中的文档必须始终保持可公开发布：

- 不写真实 token
- 不写私有主机名
- 不写运维凭据
- 不写只对某次部署有意义的内部备注

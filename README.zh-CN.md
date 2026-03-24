# 智手®（ZhiHand）

说明：智手®是 ZhiHand 的中文名称；ZhiHand 由 HandGPT 更名而来。文档中的域名、包名、命令与代码标识保持英文。

当前核心版本：`0.10.1`

智手®让 OpenClaw 能看懂 Android 手机，并通过 `ZhiHand Device` 帮你操作手机。

## 从这里开始

可以把智手®理解成三部分协同工作：

- `Brain`
  OpenClaw 负责理解请求并决定下一步。
- `Eye`
  Android App 只在你授权时共享当前屏幕。
- `Hand`
  `ZhiHand Device` 把真正的输入动作发给手机。

推荐给第一次接触智手®的用户走这条路径：

1. 安装 Android App
2. 安装 OpenClaw 插件
3. 执行 `/zhihand pair`
4. 用 App 扫码
5. 连接 `ZhiHand Device`
6. 只在需要读屏时打开 `Eye`
7. 开始让 OpenClaw 帮你处理手机任务

普通首次使用不需要自建服务端。

## 开始前你需要什么

最短可用路径默认你已经具备：

- 一台装有智手® App 的 Android 手机
- 一个 `ZhiHand Device`
- 一台可运行 `openclaw` 命令的 OpenClaw 宿主机
- 宿主机 shell 访问权限，用来写入一次插件 token

## 最快安装路径

推荐安装方式：

```bash
openclaw plugins install clawhub:zhihand
```

如果你的环境里 ClawHub 暂时不可用，或遇到限流，可以改用 npm 兼容包：

```bash
openclaw plugins install @zhihand/openclaw
```

然后执行一次性的 OpenClaw 配置：

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

如果你的 OpenClaw 部署要求重启或 reload，请先完成这一步。然后执行：

```text
/zhihand pair
```

在浏览器中打开返回的二维码链接，再用 Android App 扫码。

## 成功之后你会看到什么

当下面几件事都成立时，说明流程已经走通：

- `/zhihand pair` 返回二维码链接，而不是报错
- App 成功完成这次配对认领
- `ZhiHand Device` 能正常连接
- `/zhihand status` 能看到已配对宿主可达
- 只有在你打开 `Eye` 之后，智手®才会开始读屏

## 安装与升级规则

对已经安装好的插件，正常升级命令是：

```bash
openclaw plugins update zhihand
```

即使你第一次是通过 npm 兼容包安装，后续正确的升级命令也仍然是这条，因为运行时插件 id 依然是 `zhihand`。

`openclaw plugins install clawhub:zhihand@<version>` 只适用于首次安装，或者删除现有扩展目录后的重装。npm 兼容路径仍然是 `openclaw plugins install @zhihand/openclaw@<version>`。

插件默认会在启动时检查 npm 兼容包是否有新的已发布版本。可以执行 `/zhihand update check` 强制刷新，或执行 `/zhihand update` 输出推荐的宿主侧升级命令。

## 该先看哪份文档

- [DISTRIBUTION.zh-CN.md](./docs/DISTRIBUTION.zh-CN.md)
  如果你是新用户、准备发布给真实用户的运营方，或者正在决定 ClawHub 与 npm 的安装路径，先看这里。
- [CONFIGURATION.zh-CN.md](./docs/CONFIGURATION.zh-CN.md)
  如果你只想走最短托管路径，或者要覆盖默认值做自托管，先看这里。
- [UPDATES.zh-CN.md](./docs/UPDATES.zh-CN.md)
  如果你关心插件、App 或设备固件如何升级，先看这里。
- [OpenClaw adapter README](./packages/host-adapters/openclaw/README.md)
  如果你是从插件包页面进入，只关心 OpenClaw 侧，先看这里。

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

## 相关仓库

- [zhihand-android](https://github.com/handgpt/zhihand-android)
  Android App、配对、权限和设备侧执行
- [zhihand-ios](https://github.com/handgpt/zhihand-ios)
  iPhone / iPad 客户端行为
- [zhihand-server](https://github.com/handgpt/zhihand-server)
  控制面部署与服务端配置

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

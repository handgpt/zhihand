# 智手®（ZhiHand）如何交付给用户

说明：智手®是 ZhiHand 的中文名称；ZhiHand 由 HandGPT 更名而来。文档中的域名、包名、命令与代码标识保持英文。

这份文档从第一次接触智手®的用户视角，解释它应该如何被安装和交付。

## 推荐的默认路径

对大多数用户，智手®应该以 3 部分交付：

1. **Android App**
2. **官方托管控制面**
3. **OpenClaw 插件**

这意味着第一次使用时，不应该要求用户先自建服务端。

## 新用户真正需要的东西

### 手机侧

用户通过 App 完成：

- 扫描配对二维码
- 连接 `ZhiHand Device`
- 只在需要时开启屏幕共享
- 发送文本、语音和附件

### OpenClaw 侧

推荐安装命令：

```bash
openclaw plugins install clawhub:zhihand
```

如果当前环境里 ClawHub 暂时不可用，或者遇到限流，可以改用 npm 兼容包：

```bash
openclaw plugins install @zhihand/openclaw
```

然后完成一次性的宿主配置：

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

本地路径安装只保留给插件开发调试：

```bash
openclaw plugins install --link /path/to/zhihand/packages/host-adapters/openclaw
```

## 第一次成功运行的流程

插件安装完成后，普通用户的流程应该是：

1. 安装 Android App
2. 安装 OpenClaw 插件
3. 把 `zhihand` 加到 `plugins.allow`
4. 把 `zhihand` 加到 `tools.allow`
5. 打开 `gateway.http.endpoints.responses.enabled`
6. 把 `plugins.entries.zhihand.config.gatewayAuthToken` 设置为当前 OpenClaw gateway token
7. 如果部署要求，重启或 reload OpenClaw
8. 执行 `/zhihand pair`
9. 在浏览器打开返回的二维码链接
10. 用 Android App 扫码
11. 连接 `ZhiHand Device`
12. 只在需要读屏时打开 `Eye`
13. 之后就可以从手机或 OpenClaw 发起任务

## 成功之后你应该看到什么

当下面这些条件成立时，说明首次启用流程已经走通：

- `/zhihand pair` 会返回二维码链接
- App 成功完成这次配对认领
- 设备成功连接
- `/zhihand status` 能看到已配对宿主可达
- 只有在打开 `Eye` 之后，智手®才开始读屏

## 常见漏配项

- `plugins.allow is empty`
  把 `zhihand` 加进 `plugins.allow`。
- `ZhiHand optional tools are not enabled for OpenClaw agent`
  把 `zhihand` 加进 `tools.allow`。
- `OpenClaw /v1/responses returned 404`
  打开 `gateway.http.endpoints.responses.enabled`。
- `ZhiHand prompt relay disabled ... gatewayAuthToken`
  把 `plugins.entries.zhihand.config.gatewayAuthToken` 设置为当前 OpenClaw gateway token。
- ClawHub 安装因为服务暂时不可用而失败
  稍后重试，或先使用 `openclaw plugins install @zhihand/openclaw` 这条兼容路径。

## 三部分分别在哪里运行

- **Android App**
  负责配对、读屏、附件输入和设备侧执行
- **官方托管控制面**
  负责保存配对状态、提示词、回复、命令和附件
- **OpenClaw 插件**
  负责把 OpenClaw 接到控制面，并暴露 `zhihand_*` 工具

相关实现仓库：

- [zhihand-android](https://github.com/handgpt/zhihand-android)
- [zhihand-ios](https://github.com/handgpt/zhihand-ios)
- [zhihand-server](https://github.com/handgpt/zhihand-server)

## 默认推荐托管模式

公共首次启用路径默认使用托管模式：

- App 默认连接官方托管地址
- OpenClaw 插件默认连接官方托管控制面
- 自托管是可选项，不该进入第一次使用流程

## 升级与版本固定

对已经安装好的插件，标准升级命令是：

```bash
openclaw plugins update zhihand
```

即使第一次安装走的是 npm 兼容包，后续正确的升级命令也仍然是这条，因为运行时插件 id 依然是 `zhihand`。

如果你需要固定版本做首次安装，或者已经删掉扩展目录准备重装，可以安装指定版本：

```bash
openclaw plugins install clawhub:zhihand@<version>
```

兼容 npm 路径：

```bash
openclaw plugins install @zhihand/openclaw@<version>
```

固定版本的 `install` 属于创建式安装。对已经安装好的插件，应使用 `openclaw plugins update zhihand`。

## 进阶用户

进阶用户仍然可以通过覆盖 control-plane endpoint 做自托管。

但这属于进阶部署路径，不应该成为默认首次启用流程。

## 用户如何发现它

推荐的发现入口：

- 仓库 README
- 插件 README
- ClawHub 列表页
- npm 兼容包页面
- OpenClawDir 或其他社区插件目录

不要假设所有 OpenClaw 部署都自带“插件商店界面”。

## 维护者发布路径

OpenClaw 适配器在 ClawHub 上使用简单包名 `zhihand`；npm 继续保留兼容包名 `@zhihand/openclaw`。

在 `packages/host-adapters/openclaw` 目录下执行：

```bash
npm run publish:clawhub -- --changelog "..."
```

这个辅助脚本会把临时发布包中的 ClawHub 名称改成 `zhihand`，自动带上 `handgpt/zhihand` 的 GitHub source metadata，并在适配器目录还有未提交改动时拒绝发布。如果你希望 ClawHub 的 source-linked verification 能正确定位源码，请先安装 CLI `npm i -g clawhub`，执行 `clawhub login`，并把对应 commit 推送出去。

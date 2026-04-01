# 配置指南

本页面介绍如何配置智手®（ZhiHand），重点介绍面向 AI 智能体的 **Model Context Protocol (MCP)** 以及传统的 OpenClaw 设置。

## AI 智能体 (MCP)

大多数用户应使用统一的 MCP Server。这允许 **Claude Code**, **Gemini CLI** 等 AI 智能体直接控制你的手机。

### 1. 安装

全局安装 `@zhihand/mcp` 包：

```bash
npm install -g @zhihand/mcp
```

这会安装 `zhihand` 命令行工具。

### 2. 交互式设置

运行 setup 命令以配置你的凭据并与 Android 或 iOS 设备配对：

```bash
zhihand setup
```

按照提示扫描二维码并授权连接。

### 3. 智能体配置

配对完成后，你可以将智手®添加到你喜欢的 AI 智能体中。

#### Claude Code

如果你将其添加到配置中，Claude Code 可以自动检测 MCP server。或者直接运行：

```bash
# 如果需要手动启动的示例
claude --mcp "zhihand serve"
```

#### Gemini CLI

将以下内容添加到你的 Gemini CLI 配置中（通常在 `~/.geminirc` 或类似文件中）：

```json
{
  "mcp": {
    "zhihand": {
      "command": "zhihand",
      "args": ["serve"]
    }
  }
}
```

### 4. CLI 子命令与运行模式

`zhihand` 命令提供了多个实用程序来管理 MCP server 及其生命周期。

#### `zhihand serve` (主要入口)

这是 AI 智能体调用以启动智手®逻辑的命令。

- **stdio 模式** (默认):
  ```bash
  zhihand serve
  ```
  当 AI 智能体（如 Claude Code, Gemini CLI）将智手®作为子进程启动时使用此模式。它通过标准输入 / 输出进行通信。
- **HTTP/SSE 模式**:
  ```bash
  zhihand serve --http
  ```
  启动一个独立的 Web 服务器，可供远程智能体或基于 Web 的工具使用。它会持续运行直到手动停止。

#### `zhihand service` (后台服务管理)

如果你希望智手®作为持久的后台守护进程运行（例如开机自启），请使用 service 相关命令：

- `zhihand service install`: 将智手®注册为系统服务（例如在 Linux 上使用 systemd，在 macOS 上使用 launchd）。
- `zhihand service uninstall`: 移除后台服务。
- `zhihand service status`: 检查后台守护进程当前是否正在运行。
- `zhihand service logs`: 查看来自后台进程的实时日志。

#### 其他实用工具

- `zhihand pair`: 仅执行设备配对（如果你不需要完整设置，这很有用）。
- `zhihand status`: 显示当前的配对状态、设备信息和服务健康状况。
- `zhihand update`: `@zhihand/mcp` 包的交互式更新管理器。

## OpenClaw 用户

OpenClaw 用户可以使用专用插件，该插件现在作为 MCP 逻辑的包装器运行。

### 1. 安装

```bash
openclaw plugins install @zhihand/openclaw
```

### 2. 信任与配置

启用插件及其工具：

```bash
openclaw config set plugins.allow '["openclaw"]' --strict-json
openclaw config set tools.allow '["openclaw"]' --strict-json
```

### 3. Gateway Token (本地中继)

智手®需要回调 OpenClaw。设置 gateway token：

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

### 4. 配对

```text
/zhihand pair
```

## 移动端 App (Android & iOS)

**Android** 和 **iOS** App 除了初始配对之外，几乎不需要额外配置：

1.  **Scan**: 与你的宿主智能体配对。
2.  **Connect**: 连接 **ZhiHand Device**（硬件 / BLE）。
3.  **Eye**: 开启屏幕共享。

### 高级设置

- **Control Plane**: 默认为 `https://api.zhihand.com`。如果使用自定义服务器，请在 App 设置中覆盖。
- **BLE Lease**: App 会自动管理智手®设备的 BLE 租约。

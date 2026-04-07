# 智手 (ZhiHand)

说明：智手是 ZhiHand 的中文名称。文档中的域名、包名、命令与代码标识保持英文。

版本：`0.32.3`

智手让 AI 智能体（Claude Code, Gemini CLI, Codex CLI, OpenClaw）能看到你的手机屏幕，并帮你操作手机。

## 架构

智手基于 **Model Context Protocol (MCP)** 构建。核心是一个常驻守护进程，内含 MCP Server、Relay（心跳、WebSocket 提示词监听、CLI 分发）和 Config API（后端切换）。

支持多用户：每个用户有独立的 WebSocket 流，设备归属于用户，各自拥有独立的 controller token。

```text
                    +--------------------------------------+
                    |         @zhihand/mcp daemon           |
                    |                                      |
                    |  MCP Server (localhost:18686/mcp)     |
                    |  Relay (心跳、提示词、CLI 分发)          |
                    |  Config API (后端 IPC)                 |
                    +----------+-----------------------+---+
                               |                       |
                    +----------v------+     +----------v------+
                    | HTTP Streamable  |     | OpenClaw Plugin  |
                    | (AI 智能体)       |     | (薄包装)          |
                    +----------+------+     +----------+------+
                               |                       |
              +----------------+-----------+-----------+------+
              |                |           |                  |
        Claude Code      Gemini CLI    Codex CLI         OpenClaw
                                |
                         +------v-------+
                         | 智手 Server   |
                         | (WebSocket)  |
                         +------+-------+
                                |
                         +------v-------+
                         | 手机 App      |
                         | (iOS/Android)|
                         +--------------+
```

## 快速开始

### 前提条件

- **Node.js >= 22**
- 手机上已安装**智手 App**（Android 或 iOS）

### 1. 安装

```bash
npm install -g @zhihand/mcp
```

### 2. 配对

```bash
zhihand pair
```

该命令会：

1. 在智手服务器创建新用户
2. 在终端显示 QR 二维码
3. 等待你用智手 App 扫码
4. 保存凭据到 `~/.zhihand/config.json`
5. 检测已安装的 AI 工具并自动配置 MCP

添加设备到已有用户：

```bash
zhihand pair <user_id>
```

### 3. 启动守护进程

```bash
zhihand start              # 前台运行
zhihand start -d           # 后台运行（日志写入 ~/.zhihand/daemon.log）
```

### 4. 开始使用

AI 智能体可以直接控制你的手机：

```
> 帮我截一张手机屏幕
> 点击设置图标
> 在搜索框里输入 "hello world"
> 向下滑动找到"关于手机"
```

## CLI 命令

```
zhihand pair [--label X]   配对新用户 + 第一台设备 + 自动配置 MCP
zhihand pair <user_id>     向已有用户添加设备
zhihand list [<user_id>]   列出用户/设备及实时在线状态
zhihand unpair <id>        移除用户 (usr_*) 或设备 (credential)
zhihand rename <cred> <n>  重命名设备（服务端 + 本地）
zhihand export <user_id>   导出用户凭据为 JSON
zhihand import <file>      从 JSON 文件导入用户凭据
zhihand rotate <user_id>   轮换 controller token

zhihand start              启动守护进程（前台）
zhihand start -d           后台启动守护进程
zhihand stop               停止守护进程
zhihand status             查看状态（配对、后端、心跳）

zhihand claude             切换后端到 Claude Code
zhihand gemini             切换后端到 Gemini CLI
zhihand codex              切换后端到 Codex CLI

zhihand test [cred] [ids]  运行设备测试
zhihand mcp                启动 stdio MCP 服务器（供 AI 宿主集成）
zhihand detect             检测可用的 CLI 工具
```

### 选项

| 选项 | 说明 |
|---|---|
| `--label <label>` | 新设备标签（配对时使用） |
| `--model, -m <name>` | 后端模型别名（如 `flash`, `sonnet`, `opus`） |
| `--port <port>` | 覆盖守护进程端口（默认 18686） |
| `-d, --detach` | 后台运行 |
| `--debug` | 启用详细调试日志 |

### 环境变量

| 变量 | 说明 |
|---|---|
| `ZHIHAND_DEVICE` | 默认 credential_id |
| `ZHIHAND_CLI` | 覆盖移动端提示词的 CLI 工具 |
| `ZHIHAND_MODEL` | 覆盖所有后端的模型 |
| `ZHIHAND_GEMINI_MODEL` | 仅覆盖 Gemini 模型 |
| `ZHIHAND_CLAUDE_MODEL` | 仅覆盖 Claude 模型 |
| `ZHIHAND_CODEX_MODEL` | 仅覆盖 Codex 模型 |

## MCP 工具

### `zhihand_control`

主控制工具：

| 操作 | 参数 | 说明 |
|---|---|---|
| `click` | `xRatio`, `yRatio` | 点击（归一化坐标 [0,1]） |
| `doubleclick` | `xRatio`, `yRatio` | 双击 |
| `longclick` | `xRatio`, `yRatio`, `durationMs` | 长按（默认 800ms） |
| `type` | `text` | 在焦点输入文字 |
| `swipe` | `startXRatio`, `startYRatio`, `endXRatio`, `endYRatio`, `durationMs` | 滑动 |
| `scroll` | `xRatio`, `yRatio`, `direction`, `amount` | 滚动 |
| `keycombo` | `keys` | 组合键 |
| `back` | -- | 系统返回键 |
| `home` | -- | 系统主页键 |
| `enter` | -- | 回车键 |
| `open_app` | `appPackage`, `bundleId`, `urlScheme`, `appName` | 打开应用 |
| `clipboard` | `clipboardAction`, `text` | 读取/设置剪贴板 |
| `wait` | `durationMs` | 本地等待 |
| `screenshot` | -- | 立即截屏 |

所有坐标使用**归一化比例**：`0.0`（左上角）到 `1.0`（右下角）。每个操作返回文字摘要和截屏。

### `zhihand_screenshot`

不执行操作，仅截取当前屏幕。无参数。

### `zhihand_system`

系统导航和媒体控制：主页、返回、最近任务、通知栏、快速设置、音量、亮度、旋转、免打扰、WiFi、蓝牙、闪光灯、飞行模式、分屏、画中画、电源菜单、锁屏。

### `zhihand_list_devices`

列出所有已配对设备的实时状态：在线/离线、电量、平台、最后活跃时间。多用户模式下标签带 `[用户名]` 前缀。

### `zhihand_pair`

配对手机设备，返回 QR 码和配对 URL。

## 工作原理

```
AI 智能体 <--HTTP Streamable--> 守护进程 (localhost:18686/mcp) <--WebSocket--> 智手 Server <--> 手机 App
```

**智能体发起的流程**（工具调用）：

1. AI 智能体调用工具（如 `zhihand_control`，`action: "click"`）
2. MCP Server 通过智手 API 入队设备命令
3. 手机 App 执行命令并发送 ACK
4. MCP Server 通过 WebSocket 接收 ACK（或 polling 回退）
5. MCP Server 获取截屏返回给智能体

**手机发起的流程**（用户在手机上说话或输入）：

1. 手机将提示词发送到智手 Server
2. 守护进程通过 WebSocket 接收提示词
3. 守护进程启动当前 CLI 工具（`claude`、`codex`、`gemini`）执行
4. 结果返回到手机

守护进程每 30 秒发送 **Brain 心跳**，使手机上的 Brain 指示灯保持绿色。

## 配置文件

```
~/.zhihand/
  config.json       用户 + 设备凭据（schema v3）
  backend.json      当前后端 + 模型选择
  daemon.pid        守护进程 PID 文件
  daemon.log        守护进程日志（后台模式）
```

## Android & iOS App

1. 下载并安装智手 **Android** 或 **iOS** App
2. 点击 **Scan** 扫描终端中的 QR 码
3. 连接 **ZhiHand Device**
4. 开启 **Eye**（屏幕共享）让智能体看到屏幕

## 切换后端

```bash
zhihand gemini                # 切换到 Gemini CLI（模型：flash）
zhihand claude                # 切换到 Claude Code（模型：sonnet）
zhihand codex                 # 切换到 Codex CLI（模型：gpt-5.4-mini）
zhihand gemini --model pro    # 自定义模型
```

切换时：
- 向守护进程发送 IPC 消息
- 自动向新后端添加 MCP 配置
- 自动从旧后端移除 MCP 配置
- 模型选择持久化到 `~/.zhihand/backend.json`

## 开发者文档

- [ARCHITECTURE.md](./docs/ARCHITECTURE.md) — 系统架构、组件、传输层
- [CONFIGURATION.md](./docs/CONFIGURATION.md) — AI 智能体和 OpenClaw 配置指南
- [PROTOCOL.md](./docs/PROTOCOL.md) — 协议设计、WebSocket/REST 端点
- [SECURITY.md](./docs/SECURITY.md) — 认证、传输安全、已知差距
- [ACTIONS.md](./docs/ACTIONS.md) — 跨运行时共享动作模型

### 开发

```bash
cd packages/mcp
npm install
npm run build         # 编译 TypeScript
npm run dev           # 开发模式
npm test              # 运行测试
```

## 公开发布规则

文档必须始终可安全发布：不写真实 token、不写私有主机名、不写运维凭据、不写部署内部备注。

## 许可证

MIT

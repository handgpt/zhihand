# 智手®（ZhiHand）

说明：智手®是 ZhiHand 的中文名称；ZhiHand 由 HandGPT 更名而来。文档中的域名、包名、命令与代码标识保持英文。

当前核心版本：`0.15.0`

智手®让 AI 智能体（如 Claude Code, Gemini CLI, Codex CLI, OpenClaw）能看懂你的手机，并通过 `ZhiHand Device` 帮你操作手机。

## 架构

智手®基于 **Model Context Protocol (MCP)** 构建。核心实现是一个统一的 MCP Server，负责所有业务逻辑、工具定义和状态管理。

```text
                    ┌─────────────────────────────────┐
                    │          @zhihand/mcp            │
                    │  (核心业务逻辑、tool 定义、状态管理)  │
                    └──────────┬──────────────────┬────┘
                               │                  │
                    ┌──────────▼──────┐  ┌────────▼────────┐
                    │  MCP stdio/HTTP  │  │  OpenClaw Plugin │
                    │  (直接集成 CLI)   │  │  (薄包装, 调 MCP) │
                    └──────────┬──────┘  └────────┬────────┘
                               │                  │
              ┌────────────────┼──────────────────┼──────┐
              │                │                  │      │
        Claude Code      Gemini CLI       OpenClaw    Codex CLI
```

## 前提条件

- **Node.js >= 22**
- 手机上已安装 **智手® App**（Android 或 iOS）

## 快速开始

### 1. 安装

```bash
npm install -g @zhihand/mcp
```

### 2. 配对手机

```bash
zhihand setup
```

该命令会依次执行：

1. 向智手®服务器注册为插件
2. 在终端显示 QR 二维码
3. 等待你用智手® App 扫码
4. 保存凭据到 `~/.zhihand/credentials.json`
5. 检测本机已安装的 AI 工具
6. 自动选择最佳工具并配置 MCP

无需手动配置 MCP。如需切换后端：

```bash
zhihand claude             # 切换到 Claude Code
zhihand gemini             # 切换到 Gemini CLI
zhihand codex              # 切换到 Codex CLI
```

### 3. 开始使用

配置完成后，AI 智能体可以直接控制你的手机：

```
> 帮我截一张手机屏幕
> 点击位于 (0.5, 0.3) 的设置图标
> 在文本框里输入 "hello world"
> 向下滑动 5 步
> 从底部往上滑
```

## 可用工具

MCP Server 为 AI 智能体提供三个工具：

### `zhihand_control`

主控制工具，支持以下操作：

| 操作 | 参数 | 说明 |
|---|---|---|
| `click` | `xRatio`, `yRatio` | 点击（归一化坐标 0–1） |
| `doubleclick` | `xRatio`, `yRatio` | 双击 |
| `rightclick` | `xRatio`, `yRatio` | 右键 / 长按 |
| `middleclick` | `xRatio`, `yRatio` | 中键 |
| `type` | `text` | 在当前焦点输入文字 |
| `swipe` | `startXRatio`, `startYRatio`, `endXRatio`, `endYRatio` | 滑动手势 |
| `scroll` | `xRatio`, `yRatio`, `direction`, `amount` | 滚动（up/down/left/right） |
| `keycombo` | `keys` | 组合键（如 `"ctrl+c"`, `"alt+tab"`） |
| `clipboard` | `clipboardAction`, `text` | 读取或设置剪贴板 |
| `wait` | `durationMs` | 本地等待（默认 1000ms，最大 10000ms） |
| `screenshot` | — | 立即截屏 |

所有坐标使用 **归一化比例**：`0.0`（左上角）到 `1.0`（右下角），适用于任何分辨率。

每个操作都会返回文字摘要和截屏图片。

### `zhihand_screenshot`

不执行任何操作，仅截取当前屏幕。无参数。

### `zhihand_pair`

配对新手机。设置 `forceNew: true` 强制重新配对。

## CLI 命令

```
zhihand serve              启动 MCP Server（stdio 模式）
zhihand setup              交互式设置：配对 + 自动检测 + 自动配置
zhihand pair               配对手机（终端显示 QR 码）
zhihand status             查看配对状态、设备信息和当前后端
zhihand detect             检测本机已安装的 CLI 工具

zhihand claude             切换后端到 Claude Code（自动配置 MCP）
zhihand codex              切换后端到 Codex CLI（自动配置 MCP）
zhihand gemini             切换后端到 Gemini CLI（自动配置 MCP）

zhihand --help             显示帮助
```

| 选项 | 说明 |
|---|---|
| `--device <name>` | 使用指定的已配对设备 |
| `ZHIHAND_DEVICE` | 环境变量，与 `--device` 等效 |
| `ZHIHAND_CLI` | 覆盖 CLI 工具检测结果 |

## Android & iOS App

1. 下载并安装智手® **Android** 或 **iOS** App。
2. 点击 **Scan** 扫描 AI 智能体提供的 QR 码。
3. 连接你的 **ZhiHand Device**。
4. 当你希望智能体看到屏幕时，开启 **Eye**（屏幕共享）。

## 工作原理

```
AI 智能体 ←stdio→ zhihand serve (MCP Server) ←HTTPS/SSE→ 智手® Server ←→ 手机 App
```

1. AI 智能体调用工具（如 `zhihand_control`，`action: "click"`）
2. MCP Server 创建设备命令，通过智手® API 入队
3. 手机 App 接收命令、执行操作、发送 ACK
4. MCP Server 通过 SSE 实时接收 ACK（或 polling 回退）
5. MCP Server 获取截屏（原始 JPEG）并返回给智能体

## 这几部分分别在做什么

- **移动端 App (Android/iOS)**: 负责接收用户输入、上传屏幕快照、执行设备侧动作
- **智手® Server**: 存储配对状态、提示词、命令和附件
- **MCP Server (@zhihand/mcp)**: 核心实现层，为 AI 智能体提供工具
- **OpenClaw Plugin**: 专门为 OpenClaw 用户提供的 MCP Server 薄包装

## 这个仓库里有什么

这个仓库是智手®的公共核心仓库，主要包含：

- `packages/mcp/` — MCP Server 和 OpenClaw 适配器（[详细文档](./packages/mcp/README.md)）
- `packages/host-adapters/openclaw/` — 旧版 OpenClaw 宿主适配器
- 公共说明文档、协议与动作模型
- 参考服务边界

它不包含私有部署密钥，也不包含私有产品基础设施。

## 下一步看什么

- [@zhihand/mcp 详细文档](./packages/mcp/README.md) — MCP Server 完整使用说明
- [DISTRIBUTION.zh-CN.md](./docs/DISTRIBUTION.zh-CN.md) — 从用户角度解释如何安装和开始使用
- [CONFIGURATION.zh-CN.md](./docs/CONFIGURATION.zh-CN.md) — 大多数用户需要什么，进阶用户还能改什么
- [UPDATES.zh-CN.md](./docs/UPDATES.zh-CN.md) — App 与设备更新如何探测和发布
- [zhihand-android](https://github.com/handgpt/zhihand-android) — 查看 Android App 相关说明
- [zhihand-server](https://github.com/handgpt/zhihand-server) — 查看控制面部署与服务端配置说明

## 面向开发者的文档

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

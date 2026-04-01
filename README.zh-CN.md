# 智手®（ZhiHand）

说明：智手®是 ZhiHand 的中文名称；ZhiHand 由 HandGPT 更名而来。文档中的域名、包名、命令与代码标识保持英文。

当前核心版本：`0.12.0`

智手®让 AI 智能体（如 Claude Code, Gemini CLI, OpenClaw）能看懂你的手机，并通过 `ZhiHand Device` 帮你操作手机。

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

## 快速开始

### AI 智能体用户 (MCP)

使用智手®最简单的方式是通过其 MCP Server。这允许任何兼容 MCP 的工具（如 Claude Code 或 Gemini CLI）直接使用智手®工具。

1.  **安装 MCP Server**:
    ```bash
    npm install -g @zhihand/mcp
    ```

2.  **设置与配对**:
    运行 setup 命令并按照说明配对你的手机：
    ```bash
    zhihand setup
    ```

3.  **在你的工具中使用**:
    - **Claude Code**: 如果配置正确，它会自动检测 MCP server。
    - **Gemini CLI**: 在你的 MCP 配置中添加 `zhihand serve` 命令。

### OpenClaw 用户

如果你正在使用 OpenClaw，可以安装插件，它现在作为 MCP server 的薄包装运行：

1.  **安装插件**:
    ```bash
    openclaw plugins install @zhihand/openclaw
    ```

2.  **配置与信任**:
    ```bash
    openclaw config set plugins.allow '["openclaw"]' --strict-json
    openclaw config set tools.allow '["openclaw"]' --strict-json
    ```

3.  **配对**:
    ```text
    /zhihand pair
    ```
    在 Android App 中扫描二维码。

## Android & iOS App 用户

1.  下载并安装智手® **Android** 或 **iOS** App。
2.  点击 **Scan** 扫描 AI 智能体提供的二维码。
3.  连接你的 **ZhiHand Device**。
4.  当你希望智能体看屏幕时，开启 **Eye**（屏幕共享）。

## 这几部分分别在做什么

- **移动端 App (Android/iOS)**: 负责接收用户输入、上传屏幕快照与设备画像、执行设备侧动作。
- **智手® server**: 存储配对状态、提示词、命令和附件。
- **MCP Server (@zhihand/mcp)**: 核心实现层，为 AI 智能体提供工具。
- **OpenClaw plugin**: 专门为 OpenClaw 用户提供的 MCP server 包装器。

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

# 智手®（ZhiHand）路线图

说明：智手®是 ZhiHand 的中文名称；ZhiHand 由 HandGPT 更名而来。文档中的域名、包名、命令与代码标识保持英文。

这份路线图描述的是公共核心仓库视角下的交付规划。

## Phase 1：共享控制模型 (已完成)

目标：让共享控制模型可以在多个宿主环境和运行时类别中真正执行并复用。

- `control.proto` 稳定。
- `zhihandd` 提供可用的参考控制面。
- 初始 OpenClaw 集成已建立。

## Phase 2：MCP-First 架构 (当前阶段)

目标：转向以 **Model Context Protocol (MCP)** 作为主要的集成层，以支持现代 AI 智能体（如 Claude Code, Gemini CLI 等）。

主要结果：
- 统一的 `@zhihand/mcp` 包。
- 支持 `stdio` 和 `SSE/HTTP` 传输。
- 全面的工具集 (`zhihand_control`, `zhihand_screenshot`, `zhihand_pair`)。
- 面向 OpenClaw 等平台的薄包装宿主适配器。

关键工作：
1. 实现核心 MCP server 逻辑。
2. 构建交互式的 `zhihand` CLI 用于设置和管理。
3. 建立稳健的配对和凭据持久化。
4. 集成 Claude Code 和 Gemini CLI。

## Phase 3：运行时与可靠性

目标：确保在不同环境下的稳定性并改善用户体验。

主要结果：
- 通过 CLI 实现一键设置 / 安装。
- 为后台 MCP server 提供系统服务支持。
- 自动化更新和回滚机制。
- 改进可观测性和错误恢复。

## Phase 4：产品化

目标：从联通原型走向长期稳定演进的公共核心。

主要结果：
- 公共核心具备稳定的发布流程。
- 协议与适配器之间具有清晰的兼容性策略。
- 编写旧集成的迁移指南。

## 当前优先级

1. **MCP 核心工具**: 完成 `control`, `screenshot` 和 `pair` 等核心工具。
2. **CLI 体验**: `zhihand setup` 和 `zhihand status` 命令。
3. **集成文档**: Claude Code 和 Gemini CLI 的使用指南。
4. **服务可靠性**: 后台进程管理和日志。

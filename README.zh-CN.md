# 智手®（ZhiHand）

说明：智手®是 ZhiHand 的中文名称；ZhiHand 由 HandGPT 更名而来。文档中的域名、包名、命令与代码标识保持英文。

`智手®（ZhiHand）` 是智手®项目的公共核心仓库。

它负责共享协议、action model、架构说明、参考服务骨架以及可供多个宿主环境复用的宿主适配层参考代码。

这个仓库**不会**按名称列出任何私有实现仓库。

## 公共范围

这个仓库的目标是定义并稳定公共共享层：

- 协议契约
- action 语义
- 集成边界
- 宿主适配层模型
- 参考服务行为

可能接入这套共享模型的宿主环境包括：

- OpenClaw
- Codex
- Claude Code
- 其他支持插件或工具适配的宿主运行时

## 仓库结构

```text
zhihand/
  docs/
  proto/
  services/
  packages/
    host-adapters/
```

## 本仓库包含什么

- `docs/`
  公共架构、协议、仓库策略和运行时边界文档。
- `proto/`
  版本化协议定义。`proto/zhihand/control/v1/control.proto` 是公共控制契约的 source of truth。
- `services/`
  参考服务骨架，包括 `zhihandd`。
- `packages/`
  公共宿主适配层包和参考适配器代码。

## 职责

这个仓库需要回答以下问题：

- 智手®（ZhiHand）的公共架构是什么？
- 共享控制模型中有哪些消息和 action？
- `zhihandd` 作为参考控制面服务代表什么？
- 宿主适配层应如何把宿主特有事件映射到共享模型？
- 移动端、设备端、Web 端应如何接入而不重定义协议语义？

这个仓库不应变成私有产品基础设施或平台专属应用代码的容器。

当前 OpenClaw 插件还处于公开前的本地路径安装阶段；正式的 npm 安装路径会在包真正发布后再启用。

## 当前阶段

当前重点是 Phase 1：

1. 稳定 `control.proto`
2. 实现第一个可用的 `zhihandd` 控制面
3. 建立公共宿主适配层边界，首先从 OpenClaw 开始
4. 让这套共享模型可扩展到 Codex、Claude Code 等后续宿主环境
5. 保持公共核心不受私有部署细节污染

## 文档索引

- [ROADMAP.md](./ROADMAP.md)
- [ROADMAP.zh-CN.md](./ROADMAP.zh-CN.md)
- [ARCHITECTURE.md](./docs/ARCHITECTURE.md)
- [ACTIONS.md](./docs/ACTIONS.md)
- [CONFIGURATION.md](./docs/CONFIGURATION.md)
- [CONFIGURATION.zh-CN.md](./docs/CONFIGURATION.zh-CN.md)
- [PROTOCOL.md](./docs/PROTOCOL.md)
- [REPOSITORY.md](./docs/REPOSITORY.md)
- [CLIENT_REPOS.md](./docs/CLIENT_REPOS.md)
- [PRODUCTION.md](./PRODUCTION.md)
- [PRODUCTION.zh-CN.md](./PRODUCTION.zh-CN.md)

## 工作规则

- `control.proto` 是公共协议层的 source of truth。
- 共享语义属于这里。
- 带有 secret 的部署逻辑、产品私有基础设施不属于这里。
- 平台原生实现应放在公共核心之外，除非它是一个公共参考适配器。
- 本仓库中的文档必须保持可公开发布。

# 智手®（ZhiHand）历史生产方案说明

说明：智手®是 ZhiHand 的中文名称；ZhiHand 由 HandGPT 更名而来。文档中的域名、包名、命令与代码标识保持英文。

本文档记录的是智手®早期的 Phase 1 生产方案设想，仅作为历史设计背景保留。

## 当前状态

这是历史归档文档，不应再被视为当前生产架构说明。

## 当前生产形态

当前已实现并对外使用的产品链路是：

- Android app 连接官方托管 control plane
- OpenClaw 连接官方托管 control plane
- `pair.zhihand.com` 作为标准二维码落地页
- `api.zhihand.com` 作为 app 与 OpenClaw 共用的 control-plane endpoint

当前应以这些文档为准：

- [README.md](./README.md)
- [CONFIGURATION.md](./docs/CONFIGURATION.md)
- [DISTRIBUTION.md](./docs/DISTRIBUTION.md)

## 历史 Tunnel 方向

更早的 Phase 1 设想曾假定：

- App 通过 Cloudflare Tunnel 直接连接宿主适配器
- `<edge-id>.edge.zhihand.com` 作为实时链路上的宿主入口
- hosted control plane 主要只承担 provisioning 与生命周期管理

这已经不是当前默认实现。

## 保留本文档的原因

保留这份归档文档，是因为这套历史 Tunnel 方案仍可能为以下方向提供参考：

- 未来可选的 edge-host 模式
- 自托管或低延迟实验形态
- `edge-id` 之类的命名约定

如果以后重新引入 tunnel 作为实时默认路径，应另写新的生产设计文档，而不是继续复用本归档说明。

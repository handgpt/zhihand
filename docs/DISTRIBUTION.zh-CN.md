# 智手®（ZhiHand）发布方式

说明：智手®是 ZhiHand 的中文名称；ZhiHand 由 HandGPT 更名而来。文档中的域名、包名、命令与代码标识保持英文。

本文档定义智手®（ZhiHand）对外发布的推荐形态。

## 推荐发布形态

智手®（ZhiHand）建议拆成 3 部分发布：

1. Android app
2. 托管 control plane
3. OpenClaw 插件包

不要把 OpenClaw 插件当成唯一产品形态。

## OpenClaw 分发方式

当前正式主路径：

- 通过 npm 包，使用官方 OpenClaw 插件安装命令安装

正式安装命令：

```bash
openclaw plugins install @zhihand/openclaw
```

本地开发 fallback：

- 只有在开发插件本体时，才建议从本地 checkout 直接安装

本地开发安装命令：

```bash
openclaw plugins install --link /path/to/zhihand/packages/host-adapters/openclaw
```

推荐发现入口：

- 插件 README
- OpenClawDir 或其他社区插件目录
- 如果宿主支持，再补 external catalog

不要假设所有 OpenClaw 部署都自带一套官方插件商店界面。

## 托管模式与自托管

第一阶段推荐：

- Android app 默认使用官方托管 pairing / control-plane
- OpenClaw 插件默认指向官方托管 control plane
- 用户首次使用不需要自建 server

后续如需自托管，再通过配置覆盖 control-plane endpoint。

## 其他宿主

对于非 OpenClaw 的“claw 类”宿主：

- 保持公共 control-plane contract 稳定
- 为各宿主提供薄适配器
- 不要把公共协议绑死在 OpenClaw 私有运行时细节上

## 用户流程

1. 安装智手® Android app
2. 安装 OpenClaw 插件
3. 根据宿主要求重启或重新加载 OpenClaw
4. 执行 `/zhihand pair`
5. 在 Android app 中扫码
6. 连接 `ZhiHand Device`
7. 需要读屏时，再接通 `Eye`
8. 后续即可从 Android app 或 OpenClaw 发起任务

## 模块边界

OpenClaw 插件应保持为薄层：

- pairing
- control-plane polling
- `zhihand_*` tools
- native OpenClaw agent relay

不要让插件重新长成一套 planner 或第二个 control plane。

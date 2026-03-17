# 智手®（ZhiHand）如何发布

说明：智手®是 ZhiHand 的中文名称；ZhiHand 由 HandGPT 更名而来。文档中的域名、包名、命令与代码标识保持英文。

这份文档从用户角度解释：智手®应该如何交付给真实用户。

## 推荐的产品形态

智手®最适合拆成 3 部分交付：

1. **Android App**
2. **官方托管控制面**
3. **OpenClaw 插件**

这样用户第一次使用时，不需要先自建服务端。

## 用户实际需要安装什么

### 1. Android App

用户通过 App 完成：

- 扫配对二维码
- 连接 `ZhiHand Device`
- 在需要时打开屏幕共享
- 发送文本、语音和附件

### 2. OpenClaw 插件

正式安装命令：

```bash
openclaw plugins install @zhihand/openclaw
```

这是面向普通用户的主要安装方式。

本地路径安装只保留给插件开发调试：

```bash
openclaw plugins install --link /path/to/zhihand/packages/host-adapters/openclaw
```

## 用户第一次使用的流程

1. 安装 Android App
2. 安装 OpenClaw 插件
3. 按需要重启或重新加载 OpenClaw
4. 执行 `/zhihand pair`
5. 在浏览器打开返回的二维码链接
6. 用 Android App 扫码
7. 连接 `ZhiHand Device`
8. 当需要读屏时，再打开 `Eye`
9. 后续即可从手机或 OpenClaw 发起任务

## 三部分分别在哪里运行

- **Android App**
  负责配对、读屏、附件输入和设备侧执行
- **官方托管控制面**
  负责保存配对状态、提示词、回复、命令和附件
- **OpenClaw 插件**
  负责把 OpenClaw 接到控制面，并暴露 `zhihand_*` 工具

相关实现仓库：

- [zhihand-android](https://github.com/handgpt/zhihand-android)
- [zhihand-server](https://github.com/handgpt/zhihand-server)

## 默认推荐托管模式

第一阶段推荐直接使用官方托管默认值：

- Android App 默认连接官方托管地址
- OpenClaw 插件默认连接官方托管控制面
- 用户首次使用不需要先自建 server

## 用户如何发现它

推荐的发现入口：

- 仓库 README
- 插件 README
- npm 包页面
- OpenClawDir 或其他社区插件目录

不要假设所有 OpenClaw 部署都自带“插件商店界面”。

## 进阶用户

如果你是进阶用户，也可以覆盖 control-plane endpoint 做自托管。

但那是进阶部署路径，不应该成为默认 onboarding。

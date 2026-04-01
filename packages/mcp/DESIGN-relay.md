# ZhiHand Daemon Design: One Persistent Process

## Problem

当前架构中 `zhihand serve` 是一个被 AI 工具 fork 的短命子进程（stdio MCP），存在以下问题：

1. **没有常驻进程** — 没有心跳，手机 Brain 永远灰色
2. **手机 → AI 不通** — 手机发 prompt 到服务器，但本地没有进程消费
3. **多进程混乱** — `zhihand serve`（MCP stdio）、`zhihand relay`（心跳+prompt）、`zhihand gemini`（切换后端）是三个独立概念，用户需要理解和管理多个进程

## 设计目标

**一个常驻后台进程，包含所有能力。**

- `zhihand start` — 启动守护进程（MCP Server + Relay + 心跳）
- `zhihand gemini` — 告诉守护进程切换到 Gemini 后端
- `zhihand claude` — 告诉守护进程切换到 Claude 后端
- `zhihand stop` — 停止守护进程

## Architecture

```
                     zhihand daemon (一个进程，常驻后台)
                    ┌──────────────────────────────────────┐
                    │                                      │
                    │  ┌─────────────────────────────┐     │
                    │  │  MCP Server (HTTP transport) │◄────┼──── Gemini CLI / Claude Code / Codex
                    │  │  localhost:18686/mcp          │     │     (通过 HTTP MCP 连接)
                    │  └─────────────────────────────┘     │
                    │                                      │
                    │  ┌─────────────────────────────┐     │
                    │  │  Relay                       │     │
                    │  │  - 心跳 (30s)                │◄────┼──── zhihand-server (SSE/poll)
                    │  │  - Prompt 监听 (SSE)         │     │
                    │  │  - CLI 异步派发              │────►┼──── gemini -i / claude -p / codex -q
                    │  │  - Reply 回传                │     │
                    │  └─────────────────────────────┘     │
                    │                                      │
                    │  ┌─────────────────────────────┐     │
                    │  │  Config API (IPC)            │◄────┼──── zhihand gemini / zhihand claude
                    │  │  - 切换后端                   │     │     (CLI 命令，发指令给 daemon)
                    │  │  - 查询状态                   │     │
                    │  └─────────────────────────────┘     │
                    │                                      │
                    └──────────────────────────────────────┘
```

### 双向通信

```
方向 1：AI → 手机
  Gemini CLI ──HTTP MCP──► daemon (MCP Server) ──HTTPS──► zhihand-server ──► 手机

方向 2：手机 → AI
  手机 ──► zhihand-server ──SSE──► daemon (Relay) ──spawn──► gemini -i ──► daemon ──HTTPS──► zhihand-server ──► 手机
```

## 命令体系

```bash
zhihand start              # 启动守护进程（前台模式，Ctrl+C 停止）
zhihand start -d           # 后台守护模式（detach）
zhihand stop               # 停止守护进程

zhihand gemini             # 切换后端到 Gemini CLI
zhihand claude             # 切换后端到 Claude Code
zhihand codex              # 切换后端到 Codex CLI

zhihand status             # 查看状态：配对信息、当前后端、brain 状态、MCP 端口
zhihand setup              # 首次设置：配对 + 检测工具 + 自动选择后端 + 启动 daemon
zhihand pair               # 仅配对

zhihand serve              # 兼容模式：stdio MCP（向后兼容旧配置）
```

## 组件详解

### 1. MCP Server（HTTP Transport）

使用 MCP SDK 的 `StreamableHTTPServerTransport`，监听 `localhost:18686`。

**为什么用 Streamable HTTP 而非 stdio？**
MCP 规范明确区分两种 transport：
- **stdio**：客户端 fork 服务端为子进程，生命周期绑定（服务端随客户端退出）
- **Streamable HTTP**：服务端独立运行，支持多客户端同时连接（MCP 规范推荐的 daemon 模式）

daemon 需要独立于 AI 工具的生命周期（心跳、relay 必须常驻），所以 Streamable HTTP 是正确选择。

AI 工具的 MCP 配置变为：

**Gemini CLI:**
```bash
gemini mcp add --transport http --scope user zhihand http://localhost:18686/mcp
```

**Claude Code:**
```bash
claude mcp add --transport http zhihand http://localhost:18686/mcp
```

**Codex CLI:**
```bash
codex mcp add zhihand --url http://localhost:18686/mcp
```

好处：
- Daemon 不是 AI 工具的子进程，生命周期独立
- 多个 AI 工具可以同时连接同一个 MCP Server
- Daemon 重启后 AI 工具可以自动重连

**向后兼容**：`zhihand serve` 仍保留 stdio 模式，旧配置不受影响。

### 2. Relay（心跳 + Prompt 消费 + CLI 派发）

#### 心跳

```
POST /v1/credentials/{id}/brain-status
Header: x-zhihand-controller-token: <token>
Body: {"plugin_online": true}
```

- 启动时立即发送
- 每 30s 一次
- 失败后 5s 快速重试（不用指数退避，要赶在 40s TTL 之前恢复）
- Daemon 停止时发送 `{"plugin_online": false}`

#### Prompt 监听

**主通道：SSE**
```
GET /v1/credentials/{id}/events/stream?topic=prompts
Header: x-zhihand-controller-token: <token>
```

- 接收 `prompt.snapshot`（连接时初始状态）和 `prompt.queued`（新 prompt）
- SSE 看门狗：45s 无数据（含 keepalive comment）则强制断开重连
- 断线后 3s 重连

**兜底：Polling**

SSE 断连期间，每 2s poll 一次 `GET /v1/credentials/{id}/prompts?limit=5`。

#### CLI 异步派发

**必须用 async `child_process.spawn`**，不能用 `spawnSync`。
`spawnSync` 会阻塞 Node.js 事件循环，导致心跳在 CLI 执行期间（最长 120s）无法发送，Brain 会变灰。

| 后端 | 命令 | 模式 |
|------|------|------|
| gemini | `gemini --approval-mode yolo --model <model> -i "<text>"` | 交互模式（-i），完整 agent 能力 |
| claudecode | `claude -p "<text>" --output-format json` | 非交互 |
| codex | `codex -q "<text>" --json` | 非交互 |

**Gemini 交互模式说明**（参照 skills 模式）：
- 使用 `-i`（interactive）而非 `-p`（prompt），Gemini 以完整 agent 模式运行
- `--approval-mode yolo`：自主执行，不需要人工确认
- 环境变量：`GEMINI_SANDBOX=false`, `TERM=xterm-256color`, `COLORTERM=truecolor`
- 模型：`--model` 指定，默认 `gemini-3.1-pro-preview`，可通过 `CLAUDE_GEMINI_MODEL` 覆盖
- `-i` 模式下 Gemini 完成任务后会自动退出
- PTY 模拟：使用 `node-pty` 或 `child_process.spawn` + stdio pipe 捕获输出

其他约束：
- 超时 120s（< 150s App 超时，留 30s buffer）
- 两段 kill：SIGTERM → 等 2s → SIGKILL
- 输出截断：100KB 上限
- 并发排队：`isProcessing` flag + `promptQueue`，新 prompt 入队等待，不丢弃
- Prompt 去重：`processedPromptIds: Set<string>`，防止 SSE/Polling 重复处理
- 仅允许已知后端（claudecode/codex/gemini），拒绝任意命令

#### Reply 回传

直接 POST reply（不预先 GET 检查取消状态，避免 TOCTOU 竞态）：
```
POST /v1/credentials/{id}/prompts/{promptId}/reply
Header: x-zhihand-controller-token: <token>
Body: {"role": "assistant", "text": "<结果>"}
```
- 如果 prompt 已被取消，服务器返回 4xx，daemon 忽略
- CLI 失败时 POST 错误信息作为 reply
- 完成后处理 promptQueue 中的下一个

### 3. Config API（IPC：进程间通信）

`zhihand gemini` 等命令不再是独立进程，而是向 daemon 发指令。

**实现方式**：通过 HTTP 端点（复用 daemon 的 HTTP 服务器）。

```
POST http://localhost:18686/internal/backend
Body: {"backend": "gemini"}
→ Daemon 更新内存中的 activeBackend，保存到 backend.json
→ 返回 {"ok": true, "backend": "gemini"}

GET http://localhost:18686/internal/status
→ 返回 {"backend": "gemini", "brain": "online", "paired": true, ...}
```

命令行逻辑：
- `zhihand gemini` → POST 到 daemon 切换后端
- 如果 daemon 没运行 → 提示 "Daemon not running. Start with: zhihand start"
- `zhihand status` → GET daemon 状态

### 4. 自动 MCP 配置

当用户运行 `zhihand gemini`：
1. 通知 daemon 切换后端到 gemini
2. 自动运行 `gemini mcp add --transport http --scope user zhihand http://localhost:18686/mcp`
3. 移除其他后端的 MCP 配置（如有）

当用户运行 `zhihand claude`：
1. 通知 daemon 切换后端到 claude
2. 自动运行 `claude mcp add --transport http zhihand http://localhost:18686/mcp`
3. 移除其他后端的 MCP 配置

当用户运行 `zhihand codex`：
1. 通知 daemon 切换后端到 codex
2. 自动运行 `codex mcp add zhihand --url http://localhost:18686/mcp`
3. 移除其他后端的 MCP 配置

MCP 配置统一指向 `http://localhost:18686/mcp`（Streamable HTTP），不再是 `zhihand serve`（stdio）。
这是 MCP 规范推荐的 daemon/多客户端模式。

## 端口与文件

```
localhost:18686          # Daemon HTTP 端口（MCP + internal API）
~/.zhihand/
├── credentials.json     # 配对凭据（0600 权限）
├── backend.json         # 当前后端选择
├── daemon.pid           # Daemon PID（用于 zhihand stop）
└── state.json           # 配对 session 状态
```

## 生命周期

```
zhihand start
  │
  ├─ 检查是否已有 daemon 运行（读 daemon.pid）
  ├─ 加载 credentials.json + backend.json
  ├─ 启动 HTTP 服务器 (localhost:18686)
  │   ├─ /mcp           → MCP StreamableHTTP transport
  │   ├─ /internal/*    → Config API
  │
  ├─ 启动心跳循环 (30s)
  ├─ 连接 SSE 监听 prompts
  ├─ 写入 daemon.pid
  ├─ 输出 "ZhiHand daemon started. Backend: Gemini CLI. Port: 18686"
  │
  ├─ 运行中...
  │   ├─ 心跳持续发送 → Brain 绿色
  │   ├─ Prompt 到来 → 异步派发 CLI → 回传 reply
  │   ├─ AI 工具连接 → MCP 工具调用 → 控制手机
  │   ├─ zhihand gemini/claude → 切换后端
  │
  └─ SIGINT/SIGTERM:
       ├─ 发送 brain offline
       ├─ 关闭 HTTP 服务器
       ├─ Kill 运行中的 CLI 进程
       ├─ 删除 daemon.pid
       └─ 退出
```

## `zhihand setup` 完整流程

```
zhihand setup
  1. 配对手机（注册插件 + QR 码 + 等待扫描）
  2. 检测 CLI 工具
  3. 自动选择最佳后端
  4. 配置 MCP（HTTP transport）
  5. 启动 daemon（前台模式）

  输出：
  "Paired: mcp-Xeners-MacBook-Air-M1 (crd_xxx)
   Backend: Gemini CLI
   MCP configured for Gemini CLI (http://localhost:18686/mcp)
   Daemon running. Brain: online. Ctrl+C to stop."
```

## 错误处理

| 场景 | 行为 |
|------|------|
| Daemon 已在运行 | `zhihand start` 提示已运行，显示 PID |
| Daemon 未运行 | `zhihand gemini` 提示先启动 daemon |
| 后端 CLI 未安装 | 切换时报错，不切换 |
| 端口被占用 | 启动失败，提示端口冲突 |
| CLI 执行失败 | POST 错误信息作为 reply |
| CLI 超时 (120s) | SIGTERM → 2s → SIGKILL，POST 超时 reply |
| SSE 断连 | 自动重连 + polling 兜底 |
| 心跳失败 | 5s 快速重试 |
| credentials.json 缺失 | 提示运行 `zhihand setup` |

## 文件结构

```
packages/mcp/src/
├── daemon/
│   ├── index.ts           # Daemon 主入口（启动 HTTP 服务器 + Relay）
│   ├── heartbeat.ts       # 心跳循环
│   ├── prompt-listener.ts # SSE + polling prompt 监听
│   ├── dispatcher.ts      # 异步 CLI 派发（spawn + 超时 + kill）
│   └── internal-api.ts    # /internal/* 路由（切换后端、查询状态）
├── index.ts               # MCP Server 定义（工具注册）
├── core/                  # 现有：config, command, screenshot, sse, pair
├── tools/                 # 现有：schemas, control, screenshot, pair
└── cli/                   # 现有：detect, spawn, mcp-config, openclaw
```

`bin/zhihand` 新增：
```
case "start": → 启动 daemon
case "stop":  → 读 PID，发 SIGTERM
case "relay": → 等同于 "start"（别名，向后兼容）
```

## Server API 汇总

| 用途 | 方法 | 端点 | 认证 |
|------|------|------|------|
| 心跳 | POST | `/v1/credentials/{id}/brain-status` | `x-zhihand-controller-token` |
| SSE prompts | GET | `/v1/credentials/{id}/events/stream?topic=prompts` | `x-zhihand-controller-token` |
| Poll prompts | GET | `/v1/credentials/{id}/prompts?limit=N` | `x-zhihand-controller-token` |
| 获取 prompt | GET | `/v1/credentials/{id}/prompts/{id}` | `x-zhihand-controller-token` |
| 回传 reply | POST | `/v1/credentials/{id}/prompts/{id}/reply` | `x-zhihand-controller-token` |
| 入队命令 | POST | `/v1/credentials/{id}/commands` | `x-zhihand-controller-token` |
| 获取命令 | GET | `/v1/credentials/{id}/commands/{id}` | `x-zhihand-controller-token` |
| 截屏 | GET | `/v1/credentials/{id}/screen` | `x-zhihand-controller-token` |

## 对比

| 维度 | 旧（多进程） | 新（单 daemon） |
|------|-------------|----------------|
| 进程数 | N 个（每个 AI 工具 fork 一个） | 1 个 |
| Brain 状态 | 永远灰色 | 启动即绿色 |
| 手机 → AI | 不通 | SSE 实时接收 |
| MCP transport | stdio（被 fork） | HTTP（独立） |
| 切换后端 | 启动新进程 | 发指令给 daemon |
| 生命周期 | 跟 AI 工具绑定 | 独立，用户控制 |

## Gemini Review（gemini-3.1-pro-preview）

评价：**"architecture is solid"**，已整合所有反馈。

### 已确认的设计要点

- [x] async spawn（不用 spawnSync）
- [x] 心跳 5s 快速重试
- [x] SSE 看门狗 45s
- [x] 两段 kill（SIGTERM → 2s → SIGKILL）
- [x] CLI 输出 100KB 截断
- [x] 后端白名单
- [x] HTTP MCP transport
- [x] daemon.pid 防重复启动

### Review 发现的额外问题（已整合）

1. **SSE 与 Polling 去重**：SSE 重连和 polling 可能同时返回同一 prompt。用 `processedPromptIds: Set<string>` 去重。

2. **取消检查改进**：不再 GET 检查取消状态，直接 POST reply。如果 prompt 已取消，服务器返回 4xx，daemon 忽略即可。省一次 HTTP roundtrip，避免 TOCTOU 竞态。

3. **HTTP 绑定安全**：必须 `server.listen(18686, '127.0.0.1')`，**禁止** `0.0.0.0`。否则同网络的人可以调用 MCP 工具控制手机。

4. **Stale PID 检测**：`zhihand start` 读到 daemon.pid 后，用 `process.kill(pid, 0)` 检查进程是否还活着。崩溃后残留的 pid 文件不能阻止重启。

5. **端口冲突**：支持 `ZHIHAND_PORT` 环境变量覆盖默认端口。

6. **并发 prompt 排队**：`isProcessing` 为 true 时，新到达的 prompt 放入本地 `queue: string[]`，当前任务完成后自动处理下一个。不丢弃用户请求。

7. **spawn detached: false**：确保 daemon 被 SIGKILL 时子进程不会孤儿化。

8. **命令注入防护**：spawn 必须用参数数组 `spawn('gemini', ['-i', prompt])`，禁止 `shell: true`。


## 统一 Plugin 身份 + 心跳 + Prompt 路由（2026-04-12）

> 系统未上线，无兼容性需求。
> Gemini 3.1 Pro 审核于 2026-04-13。

### 问题

当前 daemon 三处假设了「单 credential」模型：

1. **`pair.ts`** 每次 pair 生成新 `stableIdentity`（`mcp-${Date.now()}`）→ 新 Plugin → 新 EdgeID。同一台电脑上多个 credential 分属不同 Edge。
2. **`heartbeat.ts`** 只对一个 credential 发心跳（`/v1/credentials/${credentialId}/brain-status`）。其他 Edge 上的 credential 看到后端 offline。
3. **`PromptListener`** 只监听一个 credential 的 WS（`/v1/credentials/${credentialId}/ws?topic=prompts`）。其他 credential 的 prompt 丢失。

### 目标

- 一台电脑 = 一个 Plugin = 一个 EdgeID，所有 credential 共享
- 一次心跳 → 该 Edge 下所有 credential 的 brain_status 同步 online
- 所有 credential 的 prompt 都被 daemon 接收（单 WS 连接）

### P0：持久化 Plugin 身份（修复根因）

#### 现状

```typescript
// pair.ts:162
const stableIdentity = `mcp-${Date.now().toString(36)}`;
// pair.ts:263 (executePairingAddDevice)
const stableIdentity = `mcp-${Date.now().toString(36)}`;
```

每次 pair 生成新 identity → `registerPlugin()` 匹配不到 → server 创建新 Plugin → 新 EdgeID。

#### 方案

在 `~/.zhihand/identity.json` 持久化 stableIdentity、edgeId 和 pluginSecret。所有 pair 操作复用同一 identity。

> **Gemini 审核要点**：Server 的 `RegisterPlugin` 现在返回 `plugin_secret`（见 zhihand-server/TODO.md），daemon 必须持久化该 secret 用于心跳和 WS 鉴权，彻底解耦机器身份与用户 token。

##### 新增 `config.ts` 函数

```typescript
// config.ts — identity 持久化

const IDENTITY_PATH = path.join(ZHIHAND_DIR, "identity.json");

interface PluginIdentity {
  stable_identity: string;
  edge_id: string;
  plugin_secret: string;    // ← 新增：Plugin 级别鉴权凭证
}

/** 读取持久化的 Plugin 身份，不存在返回 null */
export function loadPluginIdentity(): PluginIdentity | null {
  try {
    const raw = fs.readFileSync(IDENTITY_PATH, "utf-8");
    const data = JSON.parse(raw);
    if (data.stable_identity && data.edge_id && data.plugin_secret) {
      return data as PluginIdentity;
    }
    return null;
  } catch {
    return null;
  }
}

/** 持久化 Plugin 身份 */
export function savePluginIdentity(identity: PluginIdentity): void {
  ensureZhiHandDir();
  fs.writeFileSync(IDENTITY_PATH, JSON.stringify(identity, null, 2), {
    mode: 0o600,   // 仅文件所有者可读写（含 plugin_secret）
  });
}
```

##### 提取公共函数 `ensurePluginIdentity()`

```typescript
// config.ts 或 pair.ts

import { registerPlugin } from "./api.ts";

export async function ensurePluginIdentity(endpoint: string): Promise<PluginIdentity> {
  let identity = loadPluginIdentity();
  const stableId = identity?.stable_identity ?? `mcp-${os.hostname()}-${Date.now().toString(36)}`;
  const plugin = await registerPlugin(endpoint, { stableIdentity: stableId });
  // server 通过 stableIdentity 匹配已有 Plugin → 返回同一个 edge_id + plugin_secret
  // 或首次注册 → 返回新的 edge_id + plugin_secret
  identity = {
    stable_identity: stableId,
    edge_id: plugin.edge_id,
    plugin_secret: plugin.plugin_secret,
  };
  savePluginIdentity(identity);
  return identity;
}
```

##### 修改 `pair.ts`

```typescript
// pair.ts — executePairingFlow (首次配对)
// 替换 pair.ts:162 附近的 stableIdentity + registerPlugin 逻辑

const identity = await ensurePluginIdentity(endpoint);
const edgeId = identity.edge_id;
```

```typescript
// pair.ts — executePairingAddDevice (添加设备)
// 替换 pair.ts:263 附近

const identity = await ensurePluginIdentity(endpoint);
const edgeId = identity.edge_id;
```

##### 并发安全

> **Gemini 审核要点**：多个 `pair` 命令并发执行时可能竞争写 `identity.json`。

使用写前检查 + 原子写入（write-to-temp + rename）：

```typescript
export function savePluginIdentity(identity: PluginIdentity): void {
  ensureZhiHandDir();
  const tmp = IDENTITY_PATH + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(identity, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, IDENTITY_PATH);  // POSIX atomic rename
}
```

实际风险极低（同一台机器上不太会并发执行 `pair`），但原子写入是好习惯。

### P0：心跳改为 EdgeID 级别 + PluginSecret 鉴权

#### 现状

```typescript
// heartbeat.ts:24-25
function buildUrl(config: ZhiHandRuntimeConfig): string {
  return `${config.controlPlaneEndpoint}/v1/credentials/${encodeURIComponent(config.credentialId)}/brain-status`;
}
```

daemon 只有一个 `config`，心跳只覆盖一个 credential 的 Edge，且使用 user 级 `controllerToken` 鉴权。

#### 方案

改用 server 新端点 `POST /v1/plugins/{edgeId}/brain-status`，使用 `pluginSecret` 鉴权（见 zhihand-server/TODO.md）。

> **Gemini 审核要点**：心跳不应使用 user 的 `controllerToken`。如果该 user 被删除或 token 撤销，整台机器对所有用户都变 offline。使用 `pluginSecret` 彻底解耦。

##### 修改 `heartbeat.ts`

```typescript
// heartbeat.ts — 新签名

export interface HeartbeatTarget {
  controlPlaneEndpoint: string;
  edgeId: string;
  pluginSecret: string;     // ← 使用 pluginSecret，不再使用 controllerToken
}

function buildUrl(target: HeartbeatTarget): string {
  return `${target.controlPlaneEndpoint}/v1/plugins/${encodeURIComponent(target.edgeId)}/brain-status`;
}

async function sendHeartbeat(target: HeartbeatTarget, online: boolean): Promise<boolean> {
  try {
    const body: Record<string, unknown> = { plugin_online: online };
    if (currentMeta.backend) body.backend = currentMeta.backend;
    if (currentMeta.model) body.model = currentMeta.model;
    const url = buildUrl(target);
    dbg(`[heartbeat] POST ${url} body=${JSON.stringify(body)}`);
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${target.pluginSecret}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });
    dbg(`[heartbeat] Response: ${response.status} ${response.statusText}`);
    return response.ok;
  } catch (err) {
    dbg(`[heartbeat] Error: ${(err as Error).message}`);
    return false;
  }
}

export async function sendBrainOnline(target: HeartbeatTarget): Promise<boolean> {
  return sendHeartbeat(target, true);
}

export async function sendBrainOffline(target: HeartbeatTarget): Promise<boolean> {
  return sendHeartbeat(target, false);
}

export function startHeartbeatLoop(target: HeartbeatTarget, log: (msg: string) => void): void {
  // ... 逻辑不变，参数从 config 改为 target ...
}
```

##### 修改 `index.ts` 启动逻辑

```typescript
// index.ts:402 附近

import { loadPluginIdentity } from "../core/config.ts";

const identity = loadPluginIdentity();
if (!identity) {
  log("[heartbeat] No plugin identity found. Run 'zhihand pair' first.");
  process.exit(1);
}

const heartbeatTarget: HeartbeatTarget = {
  controlPlaneEndpoint: resolveDefaultEndpoint(),
  edgeId: identity.edge_id,
  pluginSecret: identity.plugin_secret,
};

startHeartbeatLoop(heartbeatTarget, log);
```

##### Shutdown 时离线

```typescript
// index.ts:427 附近
await sendBrainOffline(heartbeatTarget);
```

### P0：Prompt 改为 Edge 级单 WS 连接

#### 现状

```typescript
// prompt-listener.ts:63
const wsUrl = `...ws/v1/credentials/${this.config.credentialId}/ws?topic=prompts`;
```

只监听一个 credential。如果 daemon 服务多个 user，只有一个 user 的 prompt 被接收。

#### 方案（原）per-credential 多连接 — ❌ 已否决

> **Gemini 审核要点**：为每个 credential 建立一个 WS 连接是 O(N) 反模式。连接数线性增长，且 reconcile 时的动态增删 WS 容易引发连接抖动和竞态。

#### 方案（新）Edge 级单 WS 连接

使用 server 新端点 `GET /v1/plugins/{edgeId}/ws?topic=prompts`（见 zhihand-server/TODO.md），daemon 只维护一个 WS 连接，server 将该 Edge 下所有 credential 的 prompt 推送到这个连接。

##### 重写 `PromptListener`

```typescript
// prompt-listener.ts — Edge 级 WS 连接

import type { PluginIdentity } from "../core/config.ts";
import { ReconnectingWebSocket } from "../core/ws.ts";
import { dbg } from "./logger.ts";

export interface MobilePrompt {
  id: string;
  credential_id: string;
  edge_id: string;
  text: string;
  status: string;
  client_message_id?: string;
  created_at: string;
  attachments?: unknown[];
}

export type PromptHandler = (prompt: MobilePrompt) => void;

export interface PromptListenerConfig {
  controlPlaneEndpoint: string;
  edgeId: string;
  pluginSecret: string;
}

export class PromptListener {
  private config: PromptListenerConfig;
  private handler: PromptHandler;
  private log: (msg: string) => void;
  private processedIds = new Set<string>();
  private rws: ReconnectingWebSocket | null = null;
  private stopped = false;

  constructor(config: PromptListenerConfig, handler: PromptHandler, log: (msg: string) => void) {
    this.config = config;
    this.handler = handler;
    this.log = log;
  }

  start(): void {
    this.stopped = false;
    this.connectWS();
  }

  stop(): void {
    this.stopped = true;
    this.rws?.stop();
    this.rws = null;
  }

  private dispatchPrompt(prompt: MobilePrompt): void {
    if (this.processedIds.has(prompt.id)) {
      dbg(`[prompt] Skipping duplicate prompt: ${prompt.id}`);
      return;
    }
    this.processedIds.add(prompt.id);
    dbg(`[prompt] Dispatching prompt: id=${prompt.id}, cred=${prompt.credential_id}, text="${prompt.text.slice(0, 100)}..."`);
    // Bounded dedup — evict oldest when limit reached
    if (this.processedIds.size > 500) {
      const arr = [...this.processedIds];
      this.processedIds = new Set(arr.slice(-250));
    }
    this.handler(prompt);
  }

  private connectWS(): void {
    if (this.stopped) return;

    // ← 关键变更：使用 Edge 级端点 + pluginSecret 鉴权
    const wsUrl = `${this.config.controlPlaneEndpoint.replace(/^http/, "ws")}/v1/plugins/${encodeURIComponent(this.config.edgeId)}/ws?topic=prompts`;

    dbg(`[ws] Connecting to ${wsUrl}`);

    this.rws = new ReconnectingWebSocket({
      url: wsUrl,
      headers: {},  // pluginSecret 通过 auth 帧发送，不放 header
      onOpen: () => {
        // 发送 auth 帧（使用 pluginSecret，不依赖 controllerToken）
        this.rws!.send(JSON.stringify({
          type: "auth",
          plugin_secret: this.config.pluginSecret,
          topics: ["prompts"],
        }));
      },
      onClose: (_code, _reason) => {
        dbg("[ws] Disconnected. ReconnectingWebSocket will retry.");
      },
      onMessage: (data) => {
        this.handleWSMessage(data);
      },
      onError: (err) => {
        dbg(`[ws] Error: ${err.message}`);
      },
    });
    this.rws.start();
  }

  private handleWSMessage(data: unknown): void {
    const msg = data as Record<string, unknown>;

    if (msg.type === "auth_ok") {
      this.log("[ws] Connected to Edge prompt stream.");
      return;
    }
    if (msg.type === "auth_error") {
      this.log(`[ws] Auth failed: ${msg.error}`);
      this.rws?.stop();
      this.rws = null;
      return;
    }
    if (msg.type === "ping") {
      this.rws?.send(JSON.stringify({ type: "pong" }));
      return;
    }
    if (msg.type === "event" || msg.kind) {
      this.handleEvent(msg as Record<string, unknown>);
    }
  }

  private handleEvent(event: Record<string, unknown>): void {
    const kind = event.kind as string | undefined;

    if (kind === "prompt.queued" && event.prompt) {
      this.dispatchPrompt(event.prompt as MobilePrompt);
    } else if (kind === "prompt.snapshot" && event.prompts) {
      for (const p of event.prompts as MobilePrompt[]) {
        if (p.status === "pending" || p.status === "processing") {
          this.dispatchPrompt(p);
        }
      }
    }
  }
}
```

##### 修改 `index.ts`

```typescript
// index.ts:406 附近

import { PromptListener } from "./prompt-listener.ts";

const promptListener = new PromptListener(
  {
    controlPlaneEndpoint: resolveDefaultEndpoint(),
    edgeId: identity.edge_id,
    pluginSecret: identity.plugin_secret,
  },
  (prompt) => onPromptReceived(config, prompt),
  log,
);
promptListener.start();
```

##### 优势

- **1 个 WS 连接**：不再 O(N) per-credential 连接，无论多少 credential
- **不依赖 registry 变更**：server 侧动态追踪 Edge 下所有 credential，daemon 无需 reconcile
- **不依赖 controllerToken**：pluginSecret 独立于用户生命周期
- **简化架构**：删除 `MultiPromptListener` 和所有 reconcile 逻辑

### 修改一览

| 文件 | 修改 |
|---|---|
| `core/config.ts` | 新增 `PluginIdentity`（含 `plugin_secret`）、`loadPluginIdentity()` / `savePluginIdentity()` / `ensurePluginIdentity()` |
| `core/pair.ts` | 两处 stableIdentity 替换为 `ensurePluginIdentity()` |
| `daemon/heartbeat.ts` | `HeartbeatTarget` 使用 `pluginSecret`，URL → `/v1/plugins/{edgeId}/brain-status` |
| `daemon/prompt-listener.ts` | 重写为 Edge 级单 WS 连接，使用 `pluginSecret` 鉴权 |
| `daemon/index.ts` | 启动逻辑改用 `loadPluginIdentity()`、`HeartbeatTarget`、新 `PromptListener` |

### 日志

| 场景 | 级别 | 格式 |
|---|---|---|
| Plugin identity 加载 | `info` | `[identity] Loaded: edge_id=..., stable_identity=...` |
| Plugin identity 首次创建 | `info` | `[identity] Created: edge_id=..., stable_identity=...` |
| 心跳 POST | `debug` | `[heartbeat] POST .../plugins/{edgeId}/brain-status body=...` |
| Edge prompt WS 连接 | `info` | `[ws] Connected to Edge prompt stream.` |
| Edge prompt WS 认证失败 | `error` | `[ws] Auth failed: ...` |

### 依赖关系

本 TODO 依赖 zhihand-server/TODO.md 中的以下改动：

1. `RegisterPlugin` 返回 `plugin_secret` → daemon 才能持久化
2. `POST /v1/plugins/{edgeId}/brain-status` 使用 `pluginSecret` 鉴权 → 心跳才能工作
3. `GET /v1/plugins/{edgeId}/ws?topic=prompts` Edge 级 WS → prompt 才能通过单连接接收

**建议实施顺序**：Server P0 → Backend P0 → Server P1 → Backend prompt 重写

### 工作量

| 模块 | 工作量 |
|---|---|
| `PluginIdentity` 持久化 + `ensurePluginIdentity` | 0.25 天 |
| 修改 `pair.ts` 两处 | 0.25 天 |
| `heartbeat.ts` 参数重构 + pluginSecret 鉴权 | 0.25 天 |
| `prompt-listener.ts` 重写为 Edge 级 WS | 0.5 天 |
| `index.ts` 启动/关闭逻辑改动 | 0.25 天 |
| 测试 | 0.5 天 |
| **小计** | **~2 天** |

---

## SSE → WebSocket 迁移（2026-04-06）

> 系统未上线，无兼容性需求。

### 概要

将 MCP client 所有 SSE 连接替换为 WebSocket，涉及两个 SSE 使用点：

1. **User-level stream**（`packages/mcp/src/core/sse.ts`）：device registry 事件
2. **Prompt listener**（`packages/daemon/prompt-listener.ts`）：移动端发起的任务

### 现有 SSE 代码

| 文件 | 用途 | 替换为 |
|---|---|---|
| `packages/mcp/src/core/sse.ts` | UserEventStream，fetch + 手动 line 解析 | WS client |
| `packages/daemon/prompt-listener.ts:69-140` | PromptListener SSE（topic=prompts） | WS client |
| `packages/host-adapters/openclaw/src/index.ts:887` | OpenClaw adapter SSE | 调用共享 WS client |

### P0：替换 `packages/mcp/src/core/sse.ts` → `ws.ts`

```typescript
// packages/mcp/src/core/ws.ts（替代 sse.ts）

import WebSocket from "ws";  // Node.js 环境

export class UserEventWebSocket {
  private ws: WebSocket | null = null;
  private reconnectDelay = 1000;
  private readonly maxReconnectDelay = 30000;
  private aborted = false;

  constructor(
    private endpoint: string,
    private userId: string,
    private controllerToken: string,
    private topics: string[],
    private handlers: UserEventStreamHandlers,
  ) {}

  async start() {
    this.aborted = false;
    this.connect();
  }

  private connect() {
    if (this.aborted) return;

    const topicQuery = this.topics.map(t => `topic=${t}`).join("&");
    const url = `${this.endpoint.replace(/^http/, "ws")}/v1/users/${this.userId}/ws?${topicQuery}`;

    this.ws = new WebSocket(url);

    this.ws.on("open", () => {
      // 发送 auth 消息
      this.ws!.send(JSON.stringify({
        type: "auth",
        bearer: this.controllerToken,
      }));
    });

    this.ws.on("message", (data: Buffer) => {
      const msg = JSON.parse(data.toString());
      switch (msg.type) {
        case "auth_ok":
          this.reconnectDelay = 1000;
          this.handlers.onConnected();
          break;
        case "auth_error":
          log.error(`WS auth failed: ${msg.error}`);
          this.close();
          break;
        case "ping":
          this.ws?.send(JSON.stringify({ type: "pong" }));
          break;
        case "event":
          this.dispatchEvent(msg);
          break;
      }
    });

    this.ws.on("close", (code: number) => {
      this.handlers.onDisconnected();
      if (code !== 1000 && !this.aborted) this.scheduleReconnect();
    });

    this.ws.on("error", (err: Error) => {
      log.error("WS error", err);
    });
  }

  private dispatchEvent(msg: any) {
    switch (msg.kind) {
      case "device.online":          this.handlers.onDeviceOnline(msg.credential_id); break;
      case "device.offline":         this.handlers.onDeviceOffline(msg.credential_id); break;
      case "device_profile.updated": this.handlers.onDeviceProfileUpdated(msg.credential_id, msg.payload); break;
      case "command.acked":          this.handlers.onCommandAcked(msg); break;
      case "credential.added":       this.handlers.onCredentialAdded(msg.payload); break;
      case "credential.removed":     this.handlers.onCredentialRemoved(msg.credential_id); break;
    }
  }

  private scheduleReconnect() {
    setTimeout(() => {
      this.reconnectDelay = Math.min(this.reconnectDelay * 2, this.maxReconnectDelay);
      this.connect();
    }, this.reconnectDelay);
  }

  close() {
    this.aborted = true;
    this.ws?.close(1000, "client shutdown");
  }
}
```

### P0：替换 `packages/daemon/prompt-listener.ts` 中的 SSE

```typescript
// PromptListener 改为 WS 连接 credential-level endpoint

private connectWs(credential: Credential) {
  const url = `${credential.controlPlaneEndpoint.replace(/^http/, "ws")}/v1/credentials/${credential.credentialId}/ws?topic=prompts`;

  this.ws = new WebSocket(url);
  this.ws.on("open", () => {
    this.ws.send(JSON.stringify({
      type: "auth",
      bearer: credential.credentialSecret,
      actor: "daemon",
      lane: "app",
    }));
  });
  this.ws.on("message", (data) => {
    const msg = JSON.parse(data.toString());
    if (msg.type === "ping") { this.ws.send('{"type":"pong"}'); return; }
    if (msg.type === "event" && msg.topic === "prompts") {
      this.onPrompt(msg.payload);
    }
  });
  // ... reconnect 同上
}
```

### P0：删除 SSE 代码

| 文件 | 删除 |
|---|---|
| `packages/mcp/src/core/sse.ts` | 整个文件（替换为 `ws.ts`）|
| `packages/daemon/prompt-listener.ts` | SSE fetch 逻辑（lines 69-147）+ polling fallback |
| `packages/host-adapters/openclaw/src/index.ts:887` | SSE endpoint 引用 |

### P0：依赖变更

```json
// package.json
{
  "dependencies": {
    "ws": "^8.x",               // Node.js WebSocket client
    // 删除: 无需 eventsource polyfill
  }
}
```

### 心跳

- 收到 `{ "type": "ping" }` → 回复 `{ "type": "pong" }`
- **30s 未收到 ping → close + reconnect**（watchdog timer）
- 替代原 SSE 的 `: keep-alive` comment line

### 关闭码（Gemini 3.1 Pro review 2026-04-06）

- 客户端主动关闭：`4000`（"client shutting down"）
- 服务端写入超时：`1001`（Going Away）→ 客户端自动 reconnect + `after_seq`
- 服务端 auth 失败：`4001`

### Sequence 去重

服务端 snapshot + live 事件可能有 sequence 重叠（subscribe → snapshot → stream 顺序保证无丢失，
但可能重复）。客户端维护 `lastProcessedSeq` per credential，跳过 `seq <= lastProcessedSeq` 的事件。

### UserEventStreamHandlers 接口不变

```typescript
// 接口签名完全不变，仅内部 transport 从 SSE → WS
interface UserEventStreamHandlers {
  onDeviceOnline(credentialId: string): void;
  onDeviceOffline(credentialId: string): void;
  onDeviceProfileUpdated(credentialId: string, profile: Record<string, unknown>): void;
  onCommandAcked(event: any): void;
  onCredentialAdded(credential: Record<string, unknown>): void;
  onCredentialRemoved(credentialId: string): void;
  onConnected(): void;
  onDisconnected(): void;
}
```

### 工作量估算

| 模块 | 工作量 |
|---|---|
| `ws.ts`（替代 sse.ts，UserEventWebSocket）| 0.5 天 |
| PromptListener WS 改造 | 0.25 天 |
| OpenClaw adapter 更新 | 0.25 天 |
| 删除 SSE 代码 + 更新 import | 0.25 天 |
| 心跳 watchdog | 0.25 天 |
| 测试 | 0.5 天 |
| **小计** | **~2 天** |

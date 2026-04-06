
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

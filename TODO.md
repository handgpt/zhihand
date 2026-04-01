# ZhiHand Core (zhihand) — TODO

> 临时任务清单，基于 2026-03-31 架构评审结论。完成后删除此文件。

## 背景

zhihand 是公开核心层，包含：
- `control.proto` 协议定义
- `zhihandd` 参考服务
- **MCP Server**（核心集成模式，`packages/mcp/`）
- OpenClaw host adapter（`packages/host-adapters/openclaw/`，MCP 的薄包装）

**架构核心决策**：MCP Server 是唯一的业务实现层，OpenClaw Plugin 仅做协议适配。

---

## 整体架构

```
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
        Claude Code      Codex CLI         Gemini CLI  OpenClaw
```

### 安装

```bash
npm install -g @zhihand/mcp
# 或
npx @zhihand/mcp
```

单一 npm 包，同时提供：
- 主命令 `zhihand`（MCP Server 模式 + 子命令）
- OpenClaw Plugin 入口（`bin/zhihand.openclaw`）

---

## P0：MCP Server 核心实现

### 包结构：`packages/mcp/`

```
packages/mcp/
├── src/
│   ├── index.ts              # MCP Server 入口（stdio transport）
│   ├── http.ts               # MCP Server 入口（Streamable HTTP transport）
│   ├── tools/
│   │   ├── control.ts        # zhihand_control tool
│   │   ├── screenshot.ts     # zhihand_screenshot tool
│   │   ├── pair.ts           # zhihand_pair tool
│   │   └── schemas.ts        # 参数 schema 定义
│   ├── core/
│   │   ├── command.ts        # 命令创建、入队、ACK 等待
│   │   ├── screenshot.ts     # 截屏获取（binary fetch + base64 encode）
│   │   ├── sse.ts            # SSE 连接管理、command ACK 订阅
│   │   ├── pair.ts           # 设备配对、credential 管理
│   │   └── config.ts         # 配置管理（credential、endpoint）
│   └── cli/
│       ├── detect.ts         # CLI 工具检测与登录状态
│       ├── spawn.ts          # CLI 进程启动（用于移动端发起的任务）
│       └── openclaw.ts       # OpenClaw 检测与插件自动安装
├── bin/
│   ├── zhihand               # 主命令入口（serve / setup / pair 子命令）
│   └── zhihand.openclaw      # OpenClaw Plugin 入口
├── package.json
└── tsconfig.json
```

### 命令行接口

```bash
zhihand serve              # 启动 MCP Server（stdio 模式，被 CLI 工具自动调用）
zhihand serve --http       # 启动 MCP Server（Streamable HTTP 模式）
zhihand setup              # 交互式配置：配对 + 写入 MCP 配置 + 注册服务（每步确认）
zhihand pair               # 仅执行设备配对
zhihand status             # 查看配对状态和设备信息
zhihand detect             # 检测本地可用的 CLI 工具
zhihand service install    # 注册为系统服务
zhihand service uninstall  # 移除系统服务
zhihand service status     # 查看服务运行状态
zhihand service logs       # 查看服务日志
zhihand update             # 检查更新 → 确认 → 执行 → 重启服务
zhihand update --check     # 仅检查更新，不执行
zhihand update --rollback  # 回退到上一个版本
```

### MCP Server Tools

#### `zhihand_control`

```typescript
server.tool("zhihand_control", {
  action: z.enum([
    "click", "doubleclick", "rightclick", "middleclick",
    "type", "swipe", "scroll", "keycombo",
    "clipboard",
    "wait", "screenshot"
  ]),
  xRatio: z.number().min(0).max(1).optional(),
  yRatio: z.number().min(0).max(1).optional(),
  text: z.string().optional(),
  direction: z.enum(["up", "down", "left", "right"]).optional(),
  amount: z.number().int().positive().default(3).optional(),
  keys: z.string().optional(),          // "ctrl+c", "alt+tab"
  clipboardAction: z.enum(["get", "set"]).optional(),
  durationMs: z.number().int().positive().max(10000).default(1000).optional(),
  // swipe 参数
  startXRatio: z.number().min(0).max(1).optional(),
  startYRatio: z.number().min(0).max(1).optional(),
  endXRatio: z.number().min(0).max(1).optional(),
  endYRatio: z.number().min(0).max(1).optional(),
}, async (params) => {
  // wait: Plugin 本地实现，不经过 Server/App
  if (params.action === "wait") {
    await sleep(params.durationMs ?? 1000);
    const screenshot = await fetchScreenshotBinary(config);
    return {
      content: [
        { type: "text", text: `Waited ${params.durationMs ?? 1000}ms` },
        { type: "image", data: screenshot.toString("base64"), mimeType: "image/jpeg" }
      ]
    };
  }

  // screenshot: 发送 receive_screenshot 命令，App 立即截屏（不等 2 秒）
  if (params.action === "screenshot") {
    return await handleScreenshot(config);
  }

  // 其他 HID 操作：发命令 → 等 ACK（App 端等 2 秒后截屏）→ GET 截屏
  const command = createControlCommand(params);
  await enqueueCommand(config, command);
  const ack = await waitForCommandAck(config, { commandId: command.id, timeoutMs: 15000 });
  const screenshot = await fetchScreenshotBinary(config);
  return {
    content: [
      { type: "text", text: formatAckSummary(params.action, ack) },
      { type: "image", data: screenshot.toString("base64"), mimeType: "image/jpeg" }
    ]
  };
});
```

#### `zhihand_screenshot`

```typescript
server.tool("zhihand_screenshot", {}, async () => {
  // 向 App 发送 receive_screenshot 命令（不等 2 秒，立即截屏）
  const command = createControlCommand({ action: "screenshot" });
  await enqueueCommand(config, command);
  const ack = await waitForCommandAck(config, { commandId: command.id, timeoutMs: 5000 });
  const screenshot = await fetchScreenshotBinary(config);
  return {
    content: [
      { type: "text", text: "Screenshot captured" },
      { type: "image", data: screenshot.toString("base64"), mimeType: "image/jpeg" }
    ]
  };
});
```

### 命令映射

| action | 命令类型 | payload |
|---|---|---|
| `click` | `receive_click` | `{ x, y }` |
| `doubleclick` | `receive_doubleclick` | `{ x, y }` |
| `rightclick` | `receive_rightclick` | `{ x, y }` |
| `middleclick` | `receive_middleclick` | `{ x, y }` |
| `type` | `receive_type` | `{ text }` |
| `swipe` | `receive_swipe` | `{ startX, startY, endX, endY }` |
| `scroll` | `receive_scroll` | `{ x, y, direction, amount }` |
| `keycombo` | `receive_keycombo` | `{ keys }` |
| `clipboard` | `receive_clipboard` | `{ action, text? }` |
| `screenshot` | `receive_screenshot` | `{}` |
| `wait` | 不经过 Server/App | Plugin 本地 sleep |

### 核心函数

#### `fetchScreenshotBinary()`

```typescript
async function fetchScreenshotBinary(config: ZhiHandConfig): Promise<Buffer> {
  const res = await fetch(`${config.controlPlaneEndpoint}/v1/credentials/${config.credentialId}/screen`, {
    headers: { "x-zhihand-controller-token": config.controllerToken }
  });
  if (!res.ok) throw new Error(`Screenshot fetch failed: ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}
```

Server 直接返回 `Content-Type: image/jpeg` 二进制，MCP Server 本地 base64 encode 后返回给 LLM API。

#### `waitForCommandAck()`（SSE 推送，替代轮询）

```typescript
export async function waitForCommandAck(config, options): Promise<WaitForCommandAckResult> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => resolve({ acked: false }), options.timeoutMs);
    const unsubscribe = subscribeToCommandAck(options.commandId, (ackedCommand) => {
      clearTimeout(timeout);
      unsubscribe();
      resolve({ acked: true, command: ackedCommand });
    });
    options.signal?.addEventListener("abort", () => {
      clearTimeout(timeout);
      unsubscribe();
      reject(abortError());
    });
  });
}
```

SSE 订阅 topics：`["prompts", "commands"]`

---

## P0：CLI 工具自动检测

### 文件：`packages/mcp/src/cli/detect.ts`

**启动时自动检测本机已安装且已登录的 CLI 工具：**

```typescript
interface CLITool {
  name: "claudecode" | "codex" | "gemini" | "openclaw";
  command: string;       // 实际可执行命令
  version: string;
  loggedIn: boolean;
  priority: number;      // claudecode=1, codex=2, gemini=3, openclaw=4
}

async function detectCLITools(): Promise<CLITool[]> {
  const tools = await Promise.allSettled([
    detectClaudeCode(),   // which claude && claude --version && 检查登录状态
    detectCodex(),        // which codex && codex --version && 检查登录状态
    detectGemini(),       // which gemini && gemini --version && 检查登录状态
    detectOpenClaw(),     // which openclaw && openclaw --version && 检查登录状态
  ]);

  return tools
    .filter(t => t.status === "fulfilled" && t.value !== null)
    .map(t => (t as PromiseFulfilledResult<CLITool>).value)
    .sort((a, b) => a.priority - b.priority);
}
```

**各 CLI 检测方法：**

```typescript
async function detectClaudeCode(): Promise<CLITool | null> {
  // 1. which claude → 是否安装
  // 2. claude --version → 版本号
  // 3. claude auth status (或检查 ~/.claude/ 配置) → 是否已登录
  // 返回 { name: "claudecode", command: "claude", version, loggedIn, priority: 1 }
}

async function detectCodex(): Promise<CLITool | null> {
  // 1. which codex → 是否安装
  // 2. codex --version → 版本号
  // 3. 检查 API key 配置（OPENAI_API_KEY 环境变量或 ~/.codex/ 配置）
  // 返回 { name: "codex", command: "codex", version, loggedIn, priority: 2 }
}

async function detectGemini(): Promise<CLITool | null> {
  // 1. which gemini → 是否安装
  // 2. gemini --version → 版本号
  // 3. 检查 Google Cloud 登录状态
  // 返回 { name: "gemini", command: "gemini", version, loggedIn, priority: 3 }
}

async function detectOpenClaw(): Promise<CLITool | null> {
  // 1. which openclaw → 是否安装
  // 2. openclaw --version → 版本号
  // 3. 检查 OpenClaw 登录状态（openclaw auth status 或配置文件）
  // 4. 检查 zhihand 插件是否已安装，未安装则自动安装
  // 返回 { name: "openclaw", command: "openclaw", version, loggedIn, priority: 4 }
}
```

**默认优先级**：Claude Code > Codex > Gemini > OpenClaw
- 仅选择已安装且已登录的工具
- 用户可通过 `--cli` 参数或 `ZHIHAND_CLI` 环境变量覆盖

**CLI 工具的用途**：
- MCP Server 本身不需要 CLI 工具来工作（它是被 CLI 工具调用的）
- CLI 检测用于：当移动端通过 Server 发起任务（prompt）时，MCP Server 选择可用的 CLI spawn 执行
- 例如：手机上语音输入 "帮我查一下明天的天气" → Server SSE → MCP Server → `claude -p "查天气" --output-format json`
- OpenClaw 检测时额外执行插件自动安装逻辑（见下文）

---

## P0：OpenClaw 自动检测与插件安装

### 文件：`packages/mcp/src/cli/openclaw.ts`

**启动时自动检测 OpenClaw 并安装插件：**

```typescript
async function detectAndSetupOpenClaw(): Promise<void> {
  // 1. 检测 OpenClaw 是否安装
  const openclawInstalled = await isCommandAvailable("openclaw");
  if (!openclawInstalled) return;  // 无 OpenClaw，跳过

  // 2. 检查 zhihand 插件是否已安装
  const pluginInstalled = await isZhiHandPluginInstalled();
  if (pluginInstalled) return;  // 已安装，跳过

  // 3. 自动安装插件（30 秒超时自动确认）
  console.log("[zhihand] Detected OpenClaw without ZhiHand plugin. Installing...");
  await installZhiHandPlugin({ timeoutMs: 30000, autoConfirm: true });
  console.log("[zhihand] ZhiHand plugin installed to OpenClaw.");
}

async function isZhiHandPluginInstalled(): Promise<boolean> {
  // openclaw plugin list | grep zhihand
  // 或检查 OpenClaw 配置目录
}

async function installZhiHandPlugin(options: { timeoutMs: number; autoConfirm: boolean }): Promise<void> {
  // 方案 1：从 npm registry 安装
  //   openclaw plugin install @zhihand/mcp
  //
  // 方案 2：从 OpenClaw Plugin Marketplace 安装
  //   openclaw plugin install zhihand
  //
  // 优先使用 Marketplace（如果已发布），fallback 到 npm
}
```

### OpenClaw Plugin Marketplace 与 npm 的关系

```
npm registry                    OpenClaw Marketplace
┌──────────────────┐           ┌──────────────────┐
│ @zhihand/mcp     │◄──引用──── │ zhihand           │
│                  │           │   (marketplace    │
│ 包含:             │           │    entry)          │
│ - MCP Server     │           │                  │
│ - OpenClaw Plugin│           │ metadata:          │
│ - CLI detect     │           │   npm: @zhihand/mcp│
└──────────────────┘           └──────────────────┘
```

**设计原则**：
- **npm 是唯一的代码分发渠道**：`@zhihand/mcp` 包含所有代码
- **OpenClaw Marketplace 是发现渠道**：marketplace entry 指向 npm 包
- `openclaw plugin install zhihand` 实际执行 `npm install @zhihand/mcp`
- 版本同步：marketplace 发布时引用 npm 版本号
- 用户无论从哪个渠道安装，最终得到的都是同一个 npm 包

**OpenClaw Plugin 入口**（薄包装）：

```typescript
// packages/mcp/src/openclaw.adapter.ts
// 将 OpenClaw Plugin 协议适配到 MCP core 逻辑
import { createControlCommand, fetchScreenshotBinary, waitForCommandAck, enqueueCommand } from "./core";

export function registerOpenClawTools(plugin: OpenClawPlugin, config: ZhiHandConfig) {
  // 复用 MCP Server 的 core/ 逻辑
  // 仅做 OpenClaw Plugin API ↔ MCP tool 返回格式的转换
  plugin.registerTool("zhihand_control", schema, async (params) => {
    // 直接调用 core 函数，与 MCP Server tool handler 共享逻辑
    return await executeControl(config, params);
  });
}
```

---

## P0：MCP 配置集成

### CLI 工具的 MCP 配置

用户安装后，需要在各 CLI 工具中配置 MCP Server：

**Claude Code**（`.mcp.json` 或 `claude mcp add`）：
```json
{
  "mcpServers": {
    "zhihand": {
      "command": "zhihand",
      "args": ["serve"]
    }
  }
}
```

**Codex CLI**（类似 MCP 配置格式）：
```json
{
  "mcpServers": {
    "zhihand": {
      "command": "zhihand",
      "args": ["serve"]
    }
  }
}
```

**Gemini CLI**（MCP 配置）：
```json
{
  "mcpServers": {
    "zhihand": {
      "command": "zhihand",
      "args": ["serve"]
    }
  }
}
```

> 注：`zhihand serve` 启动 MCP stdio server。credential 信息从 `~/.zhihand/credentials.json` 自动读取（`zhihand setup` 或 `zhihand pair` 时已保存）。

### 一键配置命令

```bash
# 完整 setup：配对 + 检测工具 + 写入 MCP 配置
zhihand setup

# 仅配置指定 CLI 工具（跳过配对，使用已有 credential）
zhihand setup --cli claudecode
zhihand setup --cli codex
zhihand setup --cli openclaw
zhihand setup --cli all
```

`zhihand setup` 完整流程：
1. 检测本地是否已有有效 credential → 无则执行 `zhihand pair`
2. 配对完成后，检测已安装的 CLI 工具
3. 确认后写入各工具的 MCP 配置文件
4. 检测 OpenClaw → 确认后安装插件
5. 提示是否注册系统服务 → 确认后执行
6. 每一步涉及系统修改的操作均需用户显式确认（`[y/N]`）

---

## P0：设备配对（Pair）

### 文件：`packages/mcp/src/core/pair.ts`

**复用现有 OpenClaw Plugin 的配对流程**：MCP Server 向 Server 创建配对会话 → 获取配对 URL → 终端渲染 QR 码 → 用户用手机扫码/打开链接 → App 完成 claim → MCP Server 获得 credential。

### 配对流程

```
1. zhihand pair（或 zhihand setup 触发）
   ↓
2. POST /v1/pairing/sessions
   Body: { edgeId, ttlSeconds, requestedScopes: ["observe", "session.control", "screen.read", "screen.capture", "ble.control"] }
   ← Response: { id, pair_url, qr_payload, controller_token, status: "pending", expires_at }
   ↓
3. 终端输出：
   - 配对 URL（可点击）
   - QR 码（SVG 渲染到终端）
   - 过期时间提示
   ↓
4. 用户在手机上打开 URL 或扫描 QR 码
   ↓
5. App 完成配对，Server 将 session 状态改为 "claimed"，生成 credential_id
   ↓
6. MCP Server 轮询 GET /v1/pairing/sessions/{sessionId}
   等待 status 从 "pending" → "claimed"
   ↓
7. 提取 credential_id + controller_token，保存到 ~/.zhihand/credentials.json
   ↓
8. 配对完成，后续命令使用该 credential 通信
```

### `zhihand_pair` MCP tool

```typescript
server.tool("zhihand_pair", {
  forceNew: z.boolean().default(false).optional(),
}, async (params) => {
  // 检查现有配对状态
  const existing = await loadCredential();
  if (existing && !params.forceNew) {
    const status = await refreshPairingSession(config, existing);
    if (status === "claimed") {
      return { content: [{ type: "text", text: formatPairingStatus(existing) }] };
    }
  }

  // 创建新配对会话
  const session = await createPairingSession(config, {
    edgeId: config.edgeId,
    ttlSeconds: 600,
    requestedScopes: ["observe", "session.control", "screen.read", "screen.capture", "ble.control"],
  });

  // 保存 pending 状态
  await savePairingState(session);

  // 生成 QR 码
  const qrSvg = await renderPairingQRCode(session.pairUrl);

  return {
    content: [
      { type: "text", text: [
        `Open this URL on your phone to pair:`,
        `${session.pairUrl}`,
        ``,
        `Or scan the QR code above.`,
        `Expires at: ${session.expiresAt}`,
      ].join("\n") },
    ]
  };
});
```

### CLI 命令

```bash
zhihand pair                # 创建配对会话，显示 URL + QR 码，等待手机扫码
zhihand pair --force        # 强制创建新配对（忽略已有 credential）
zhihand status              # 查看当前配对状态和设备信息
```

`zhihand pair` 终端输出示例：
```
╔══════════════════════════════════════════════════╗
║  Scan QR code or open URL on your phone to pair  ║
╠══════════════════════════════════════════════════╣
║                                                  ║
║    ██████████████  ████  ██████████████          ║
║    ██          ██  ████  ██          ██          ║
║    ██  ██████  ██    ██  ██  ██████  ██          ║
║    ...                                           ║
║                                                  ║
║  URL: https://zhihand.example.com/pair/abc123    ║
║  Expires: 10 minutes                             ║
║                                                  ║
║  Waiting for phone to scan...                    ║
╚══════════════════════════════════════════════════╝
```

### 核心实现（复用 OpenClaw 现有逻辑）

```typescript
// core/pair.ts — 从 openclaw/src/index.ts 迁移核心函数

interface PairingSession {
  id: string;
  pairUrl: string;              // 手机打开的配对 URL
  qrPayload: string;            // QR 码原始数据
  controllerToken: string;      // 后续 API 调用凭证
  edgeId: string;
  status: "pending" | "claimed" | "expired";
  credentialId?: string;        // claimed 后填入
  expiresAt: string;
}

// 创建配对会话（复用 openclaw/src/index.ts:538-562 createPairingSession）
async function createPairingSession(config, options): Promise<PairingSession> {
  const res = await fetch(`${config.endpoint}/v1/pairing/sessions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      edge_id: options.edgeId,
      ttl_seconds: options.ttlSeconds,
      requested_scopes: options.requestedScopes,
    }),
  });
  return await res.json();
}

// 等待配对完成（轮询 session 状态）
async function waitForPairingClaim(config, sessionId: string, timeoutMs = 600000): Promise<PairingSession> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const session = await refreshPairingSession(config, sessionId);
    if (session.status === "claimed" && session.credentialId) {
      return session;
    }
    await sleep(2000);  // 2 秒轮询间隔
  }
  throw new Error("Pairing timeout");
}

// 渲染 QR 码（复用 openclaw/src/index.ts:660-680 renderPairingQRCodeSVG）
async function renderPairingQRCode(url: string): Promise<string> {
  return QRCode.toString(url, { type: "terminal" });
}
```

### 本地状态存储

```typescript
// ~/.zhihand/state.json — 配对状态（与 OpenClaw 的 state.json 同构）
interface StoredPairingState {
  sessionId: string;
  controllerToken: string;
  edgeId: string;
  pairUrl: string;
  qrPayload: string;
  credentialId?: string;
  status: "pending" | "claimed" | "expired";
  expiresAt: string;
}

// ~/.zhihand/credentials.json — 已确认的 credential
```

### 多设备支持

```json
// ~/.zhihand/credentials.json
{
  "default": "my_phone",
  "devices": {
    "my_phone": {
      "credentialId": "cred_xxx",
      "controllerToken": "tok_xxx",
      "endpoint": "https://server.example.com",
      "deviceName": "Pixel 9 Pro",
      "pairedAt": "2026-03-31T12:00:00Z"
    },
    "my_ipad": {
      "credentialId": "cred_yyy",
      "controllerToken": "tok_yyy",
      "endpoint": "https://server.example.com",
      "deviceName": "iPad Pro",
      "pairedAt": "2026-03-31T13:00:00Z"
    }
  }
}
```

- `zhihand serve` 默认使用 `default` 设备
- 可通过 `--device` 参数或 `ZHIHAND_DEVICE` 环境变量切换
- `zhihand_pair` tool 也支持 LLM 在对话中触发配对

---

## P0：SSE 推送 ACK 替代轮询

### SSE 订阅

```typescript
// 当前（仅 prompts topic）
const topics = ["prompts"];
// 改为
const topics = ["prompts", "commands"];
```

### ACK 回调注册表

```typescript
// core/sse.ts
const ackCallbacks = new Map<string, (command: AckedCommand) => void>();

function handleSSEEvent(event: SSEEvent) {
  if (event.kind === "command.acked" && event.command) {
    const callback = ackCallbacks.get(event.command.id);
    if (callback) {
      callback(event.command);
      ackCallbacks.delete(event.command.id);
    }
  }
}

export function subscribeToCommandAck(commandId: string, callback: (cmd: AckedCommand) => void): () => void {
  ackCallbacks.set(commandId, callback);
  return () => ackCallbacks.delete(commandId);
}
```

---

## P0：全链路二进制传输

### 传输链路

```
App ──raw JPEG──→ Server ──缓存 []byte──→ MCP Server GET binary ──base64──→ LLM API
```

- App → Server：`Content-Type: image/jpeg`，raw bytes
- Server → MCP Server：`Content-Type: image/jpeg`，raw bytes
- MCP Server → LLM API：base64 encode（LLM API 要求）
- **仅在最后一步（提交给 LLM API）做 base64 编码**

### ACK multipart 格式

```
POST /v1/credentials/{id}/commands/{commandId}/ack
Content-Type: multipart/form-data

Part "ack": application/json
  { "status": "ok" }

Part "frame": image/jpeg
  <raw JPEG bytes>

Headers:
  X-ZhiHand-Width: 1080
  X-ZhiHand-Height: 2400
  X-ZhiHand-Captured-At: 2026-03-31T12:34:56.789Z
  X-ZhiHand-Sequence: 42
```

---

## P0：新增操作能力

### 新 action 列表

| action | 命令类型 | 参数 |
|---|---|---|
| `doubleclick` | `receive_doubleclick` | `xRatio`, `yRatio` |
| `rightclick` | `receive_rightclick` | `xRatio`, `yRatio` |
| `middleclick` | `receive_middleclick` | `xRatio`, `yRatio` |
| `scroll` | `receive_scroll` | `xRatio`, `yRatio`, `direction`, `amount` |
| `keycombo` | `receive_keycombo` | `keys` |
| `wait` | Plugin 本地实现 | `durationMs` |
| `screenshot` | `receive_screenshot` | 无 |

### 参数验证

- `direction`: enum ("up", "down", "left", "right")
- `amount`: positive integer, 默认 3
- `keys`: string, 格式 "modifier+key"，如 "ctrl+c", "shift+a", "alt+tab"
- `clipboardAction`: enum ("get", "set")
- `durationMs`: positive integer, 默认 1000, 最大 10000

---

## P0：截屏时序

| 命令类型 | App 端截屏前延迟 | 说明 |
|---|---|---|
| 所有 HID 操作 | **2000ms** | 等待 UI 稳定 |
| `receive_screenshot` | **0ms** | 立即截屏 |
| `receive_clipboard` | **0ms** | 无 UI 变化 |
| `wait` | N/A | Plugin 本地 sleep，结束后 GET 截屏 |

---

## P1：CLI Spawn（移动端发起任务）

### 场景

手机端用户发起 prompt → Server SSE → MCP Server 收到 prompt → spawn CLI 执行。

```typescript
// cli/spawn.ts
async function spawnCLITask(tool: CLITool, prompt: string): Promise<string> {
  switch (tool.name) {
    case "claudecode":
      // claude -p "prompt" --output-format json --allowedTools "zhihand_control,zhihand_screenshot"
      return await execAsync(`${tool.command} -p ${shellEscape(prompt)} --output-format json`);
    case "codex":
      // codex -q "prompt" --json
      return await execAsync(`${tool.command} -q ${shellEscape(prompt)} --json`);
    case "gemini":
      // gemini -p "prompt"
      return await execAsync(`${tool.command} -p ${shellEscape(prompt)}`);
    case "openclaw":
      // openclaw run "prompt"
      return await execAsync(`${tool.command} run ${shellEscape(prompt)}`);
  }
}
```

### 流程

```
手机 → Server (SSE prompt) → MCP Server → detectBestCLI() → spawn CLI
                                                                 ↓
                                                          CLI 调用 MCP tools
                                                          (zhihand_control 等)
                                                                 ↓
                                                          执行完毕 → 返回结果
                                                                 ↓
MCP Server → POST result to Server → SSE → 手机显示结果
```

---

## P1：更新通知与系统服务

### 背景

MCP Server 需要常驻运行以维持 SSE 连接（接收移动端发起的任务）。因此需要：
1. 系统服务注册（开机自启、崩溃重启）—— 用户显式确认
2. 更新检测与通知 —— 仅通知，用户手动执行更新
3. 用户执行更新后，服务自动重启

### 设计原则

- **不做静默自动更新**：设备控制工具的供应链安全要求更高，自动更新 = npm 包被攻陷时立即获得所有用户机器和手机的控制权
- **不做零确认系统修改**：安装服务、写入配置均需用户显式确认（`[y/N]`）
- **不使用 `postinstall` hook 重启服务**：避免本地 `npm install`（开发/CI）意外重启全局服务
- **更新由独立命令执行**：`zhihand update` 作为独立进程运行，不从被替换的进程内自我更新

### 文件结构

```
packages/mcp/src/
├── service/
│   ├── install.ts        # 系统服务安装（跨平台，需用户确认）
│   ├── uninstall.ts      # 系统服务卸载
│   ├── update.ts         # 更新检测与执行
│   ├── linux.ts          # systemd unit 生成
│   ├── macos.ts          # launchd plist 生成
│   └── windows.ts        # Windows Task Scheduler 注册
```

### 命令行接口

```bash
zhihand service install    # 注册为系统服务（需用户确认）
zhihand service uninstall  # 移除系统服务
zhihand service status     # 查看服务状态
zhihand service logs       # 查看服务日志
zhihand service restart    # 重启服务
zhihand update             # 检查更新 → 确认 → 执行 → 重启服务
zhihand update --check     # 仅检查，不执行
```

### 更新通知（Notify-Only）

**使用 `update-notifier` 模式**：非阻塞后台检查，仅在终端输出提示。

```typescript
// service/update.ts

import updateNotifier from "update-notifier";
import pkg from "../../package.json";

// 每次 CLI 命令执行时调用（非阻塞）
export function notifyIfUpdateAvailable(): void {
  const notifier = updateNotifier({
    pkg,
    updateCheckInterval: 4 * 60 * 60 * 1000,  // 4 小时检查一次
  });

  // 仅在终端输出提示，不执行任何更新操作
  notifier.notify({
    message: [
      `Update available: ${notifier.update?.current} → ${notifier.update?.latest}`,
      `Run {updateCommand} to update`,
    ].join("\n"),
    // update-notifier 自动检测包管理器（npm/yarn/pnpm）
  });
}
```

**用户看到的提示**：
```
╭──────────────────────────────────────────╮
│                                          │
│   Update available 1.2.0 → 1.3.0        │
│   Run zhihand update to update           │
│                                          │
╰──────────────────────────────────────────╯
```

### 手动更新命令

**`zhihand update` —— 独立进程执行更新，避免自我替换竞态**

```typescript
// service/update.ts

async function executeUpdate(): Promise<void> {
  // 1. 检查最新版本
  const check = await checkForUpdate("@zhihand/mcp");
  if (!check.updateAvailable) {
    console.log(`Already up to date (${check.current}).`);
    return;
  }

  // 2. 显示变更信息，等待用户确认
  console.log(`Update available: ${check.current} → ${check.latest}`);
  const confirmed = await promptConfirm("Proceed with update?");  // [y/N]
  if (!confirmed) return;

  // 3. 记录当前版本（回滚用）
  await saveRollbackInfo(check.current);

  // 4. 执行全局更新（当前进程是 zhihand update，不是 zhihand serve）
  //    更新替换的是磁盘上的文件，不影响当前正在运行的 update 进程
  execSync(`npm install -g @zhihand/mcp@${check.latest}`, { stdio: "inherit" });

  // 5. 如果服务已安装，重启服务（新版本生效）
  if (await isServiceInstalled()) {
    await restartService();
    console.log(`Service restarted with version ${check.latest}.`);
  }

  // 6. 记录更新日志
  await appendUpdateLog(check.current, check.latest);

  console.log(`Updated to ${check.latest}.`);
}
```

**关键设计：为什么是安全的**：
- `zhihand update` 是用户手动执行的独立进程
- 它更新的是磁盘文件，不是自身正在运行的代码
- 更新完成后通过平台命令重启 `zhihand serve` 服务（新进程加载新代码）
- 如果更新中断，旧版本服务仍在运行，不影响可用性

**回滚**：
```bash
zhihand update --rollback   # 回退到上一个版本
```

```typescript
async function rollback(): Promise<void> {
  const info = await loadRollbackInfo();  // ~/.zhihand/rollback.json
  if (!info) throw new Error("No rollback version recorded");
  execSync(`npm install -g @zhihand/mcp@${info.previousVersion}`, { stdio: "inherit" });
  if (await isServiceInstalled()) await restartService();
}
```

### 系统服务注册

**需要用户显式确认**：`zhihand service install` 执行前提示。

```typescript
async function installService(): Promise<void> {
  // 1. 检查端口可用性
  const port = await resolvePort();

  // 2. 显示将要执行的操作，等待确认
  console.log(`This will:`);
  console.log(`  - Register ZhiHand as a background service`);
  console.log(`  - Start zhihand serve --http --port ${port} on boot`);
  console.log(`  - Service runs as current user (no root required)`);
  console.log();

  const confirmed = await promptConfirm("Install system service?");  // [y/N]
  if (!confirmed) return;

  // 3. 平台检测 + 安装
  switch (process.platform) {
    case "linux":  await installLinuxService(port); break;
    case "darwin": await installMacService(port); break;
    case "win32":  await installWindowsService(port); break;
  }
}
```

#### HTTP 端口管理

```typescript
// 默认端口 + 冲突检测
const DEFAULT_PORT = 19816;

async function resolvePort(): Promise<number> {
  const configPort = loadConfig()?.httpPort;
  const port = configPort ?? DEFAULT_PORT;

  // 检查端口是否被占用
  if (await isPortInUse(port)) {
    // 检查是否是已运行的 zhihand 服务
    if (await isZhiHandServiceRunning()) {
      throw new Error(`ZhiHand service is already running on port ${port}. Use 'zhihand service restart' instead.`);
    }
    throw new Error(`Port ${port} is in use. Set a different port: zhihand service install --port <port>`);
  }

  return port;
}
```

#### Linux（systemd 用户级）

```typescript
// service/linux.ts

function generateSystemdUnit(port: number): string {
  const zhihandPath = which.sync("zhihand");

  return `[Unit]
Description=ZhiHand MCP Server
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart=${zhihandPath} serve --http --port ${port}
Restart=always
RestartSec=5
Environment=NODE_ENV=production
WorkingDirectory=${os.homedir()}
StandardOutput=journal
StandardError=journal
SyslogIdentifier=zhihand

[Install]
WantedBy=default.target
`;
}

async function installLinuxService(port: number): Promise<void> {
  const unitContent = generateSystemdUnit(port);
  const unitPath = path.join(os.homedir(), ".config/systemd/user/zhihand.service");

  await fs.mkdir(path.dirname(unitPath), { recursive: true });
  await fs.writeFile(unitPath, unitContent);

  execSync("systemctl --user daemon-reload");
  execSync("systemctl --user enable zhihand");
  execSync("systemctl --user start zhihand");

  // 允许用户服务在登出后继续运行
  execSync("loginctl enable-linger $USER");
}
```

#### macOS（launchd LaunchAgent）

```typescript
// service/macos.ts

function generateLaunchdPlist(port: number): string {
  const zhihandPath = which.sync("zhihand");

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.zhihand.mcp</string>
  <key>ProgramArguments</key>
  <array>
    <string>${zhihandPath}</string>
    <string>serve</string>
    <string>--http</string>
    <string>--port</string>
    <string>${port}</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${os.homedir()}/.zhihand/logs/stdout.log</string>
  <key>StandardErrorPath</key>
  <string>${os.homedir()}/.zhihand/logs/stderr.log</string>
</dict>
</plist>
`;
}

async function installMacService(port: number): Promise<void> {
  const plistContent = generateLaunchdPlist(port);
  const plistPath = path.join(os.homedir(), "Library/LaunchAgents/com.zhihand.mcp.plist");

  await fs.mkdir(path.join(os.homedir(), ".zhihand/logs"), { recursive: true });
  await fs.writeFile(plistPath, plistContent);

  execSync(`launchctl load ${plistPath}`);
}
```

#### Windows（Task Scheduler）

```typescript
// service/windows.ts

async function installWindowsService(port: number): Promise<void> {
  const zhihandPath = which.sync("zhihand");

  // Task Scheduler（不需要管理员权限）
  execSync(
    `schtasks /create /tn "ZhiHand MCP" ` +
    `/tr "\\"${zhihandPath}\\" serve --http --port ${port}" ` +
    `/sc onlogon /rl limited /f`
  );

  // 立即启动
  execSync('schtasks /run /tn "ZhiHand MCP"');
}
```

### 服务重启（平台感知）

```typescript
// service/install.ts

export async function restartService(): Promise<void> {
  switch (process.platform) {
    case "linux":
      execSync("systemctl --user restart zhihand");
      break;
    case "darwin":
      const plistPath = path.join(os.homedir(), "Library/LaunchAgents/com.zhihand.mcp.plist");
      execSync(`launchctl unload ${plistPath} && launchctl load ${plistPath}`);
      break;
    case "win32":
      execSync('schtasks /end /tn "ZhiHand MCP"');
      execSync('schtasks /run /tn "ZhiHand MCP"');
      break;
  }
}

export async function isServiceInstalled(): Promise<boolean> {
  switch (process.platform) {
    case "linux":
      return fs.existsSync(path.join(os.homedir(), ".config/systemd/user/zhihand.service"));
    case "darwin":
      return fs.existsSync(path.join(os.homedir(), "Library/LaunchAgents/com.zhihand.mcp.plist"));
    case "win32":
      try { execSync('schtasks /query /tn "ZhiHand MCP"', { stdio: "ignore" }); return true; }
      catch { return false; }
  }
  return false;
}
```

### `zhihand setup` 完整流程

```
zhihand setup
  ↓
1. 检查本地 credential → 无则执行 zhihand pair
  ↓
2. 检测 CLI 工具 → 确认后写入 MCP 配置
  ↓
3. 检测 OpenClaw → 确认后安装插件
  ↓
4. 提示是否注册系统服务 → 用户确认后执行 zhihand service install
  ↓
✓ Setup 完成
```

每一步需要系统修改的操作均显式提示用户确认。

---

## P2：坐标系统（确认，无代码改动）

- **MCP Server → App 传递的坐标始终是归一化 [0, 1]**
- 各 LLM 后端的坐标转换在 MCP Server 内部处理：
  - Claude Computer Use：绝对像素 → [0,1]
  - OpenAI CUA：绝对像素 → [0,1]
  - Gemini：[0,999] → [0,1]
  - OpenClaw：已使用 [0,1]
- App 端收到 [0,1] 后映射到实际像素：`pixelX = ratio * screenWidth`
- Server 层透传坐标，不解析不转换

---

## 后续改进（非当前批次）

### 架构级
- [ ] Proto code generation（buf/protoc）自动生成 Go/TS/Swift/Kotlin bindings
- [ ] ActionType 新增 HID 输入专用类型（`ACTION_TYPE_HID_INPUT`）
- [ ] 安全模型：BLE Passkey 配对 + Server 端 JWT
- [ ] 端到端自动化测试
- [ ] 组件间版本协商（pairing 握手时交换 protocol_version）

### MCP Server
- [ ] Streamable HTTP transport 支持（当前优先 stdio）
- [ ] MCP Server 状态持久化（credential 缓存）
- [ ] Tool 调用并发控制（防止多个 LLM 同时操作同一手机）
- [ ] 截屏缓存（避免重复 GET 相同帧）

### zhihandd 参考服务
- [ ] 明确 zhihandd vs zhihand-server 职责边界文档
- [ ] 持久化事件存储（替代内存）

---

## 关键代码路径参考

| 功能 | 文件 | 说明 |
|---|---|---|
| MCP Server 入口 | `packages/mcp/src/index.ts` | `zhihand serve` → stdio transport |
| Tool 定义 | `packages/mcp/src/tools/` | control, screenshot, pair |
| 核心逻辑 | `packages/mcp/src/core/` | 命令、截屏、SSE、配对、配置 |
| 配对逻辑 | `packages/mcp/src/core/pair.ts` | 复用 OpenClaw 配对流程（URL + QR） |
| CLI 检测 | `packages/mcp/src/cli/detect.ts` | 自动检测 cc/codex/gemini/openclaw |
| OpenClaw 集成 | `packages/mcp/src/cli/openclaw.ts` | 插件自动安装 |
| OpenClaw 适配 | `packages/mcp/src/openclaw.adapter.ts` | Plugin 薄包装 |
| CLI Spawn | `packages/mcp/src/cli/spawn.ts` | 移动端发起任务 |
| 系统服务 | `packages/mcp/src/service/` | install/uninstall/restart（跨平台，用户确认） |
| 更新通知 | `packages/mcp/src/service/update.ts` | update-notifier 检查 + `zhihand update` 手动执行 |
| 协议定义 | `proto/zhihand/control/v1/control.proto` | Protobuf schema |

---

## 延迟预估

| 场景 | 延迟 |
|---|---|
| HID 操作（click/type/scroll 等） | ~2450ms（含 2s UI 稳定等待） |
| `receive_screenshot`（纯截屏） | ~300ms |
| `wait`（Plugin 本地） | durationMs + ~100ms |
| CLI spawn（移动端发起任务） | 取决于 LLM 响应 |

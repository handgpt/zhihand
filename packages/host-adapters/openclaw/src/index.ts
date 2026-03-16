import QRCode from "qrcode";

const DEFAULT_CONTROL_PLANE_ENDPOINT = "https://api.zhihand.com";

export type ZhiHandPluginConfig = {
  endpoint?: string;
  controlPlaneEndpoint?: string;
  apiKey?: string;
  timeoutMs?: number;
};

export type OpenClawPluginManifest = {
  name: string;
  version: string;
  description: string;
  capabilities: string[];
};

export type ServerInfo = {
  service_name: string;
  version: string;
  protocol_version: string;
  capabilities: Capability[];
};

export type Capability = {
  id: string;
  display_name: string;
  version: string;
  supported_actions: string[];
  metadata?: Record<string, unknown>;
};

export type ActionInput = {
  request_id?: string;
  type: string;
  source: string;
  target?: string;
  parameters?: Record<string, unknown>;
  requested_at?: string;
};

export type ExecuteActionResponse = {
  request_id: string;
  status: string;
  result?: Record<string, unknown>;
  error?: {
    message: string;
  };
};

export type PluginRecord = {
  edge_id: string;
  edge_host: string;
  adapter_kind: string;
  display_name?: string;
  origin_listener: string;
  plugin_public_key?: string;
  created_at: string;
  updated_at: string;
};

export type RegisterPluginInput = {
  adapterKind: string;
  displayName?: string;
  originListener?: string;
  pluginPublicKey?: string;
  stableIdentity?: string;
};

export type PairingSession = {
  id: string;
  edge_id: string;
  edge_host: string;
  pair_token?: string;
  pair_url: string;
  qr_payload: string;
  requested_scopes?: string[];
  status: "pending" | "claimed" | "expired" | string;
  created_at: string;
  expires_at: string;
  claimed_at?: string;
  claimed_app_instance_id?: string;
  credential_id?: string;
  controller_token?: string;
};

export type CreatePairingSessionInput = {
  edgeId: string;
  ttlSeconds?: number;
  requestedScopes?: string[];
};

export type PairingPrompt = {
  title: string;
  body: string;
  appDownloadURL: string;
  pairURL: string;
  qrSVG: string;
};

export type WaitForClaimOptions = {
  sessionId: string;
  timeoutMs?: number;
  pollIntervalMs?: number;
  signal?: AbortSignal;
};

export type WaitForClaimResult = {
  session: PairingSession;
  iterations: number;
  claimed: boolean;
  expired: boolean;
};

export type QRCodeRenderOptions = {
  margin?: number;
  width?: number;
  darkColor?: string;
  lightColor?: string;
};

export type QueuedControlCommand = {
  type: string;
  payload?: Record<string, unknown>;
  messageId?: number;
};

export type EnqueueCommandInput = {
  credentialId: string;
  controllerToken: string;
  command: QueuedControlCommand;
};

export type EnqueueMobilePromptInput = {
  credentialId: string;
  credentialSecret: string;
  text: string;
  clientMessageId?: string;
  attachmentIds?: string[];
};

export type MobilePromptAttachmentRecord = {
  id: string;
  credential_id: string;
  edge_id: string;
  prompt_id?: string;
  client_attachment_id?: string;
  parent_client_attachment_id?: string;
  kind: "image" | "audio" | "video" | "file" | string;
  purpose?: "input" | "preview" | string;
  file_name: string;
  mime_type: string;
  byte_size: number;
  width?: number;
  height?: number;
  duration_ms?: number;
  created_at: string;
};

export type QueuedCommandRecord = {
  id: string;
  credential_id: string;
  edge_id?: string;
  status: string;
  command: QueuedControlCommand;
  created_at: string;
  delivered_at?: string;
  acked_at?: string;
  ack_status?: string;
  ack_result?: Record<string, unknown>;
};

export type ScreenSnapshotRecord = {
  credential_id: string;
  edge_id: string;
  mime_type: string;
  encoding: string;
  width: number;
  height: number;
  captured_at: string;
  uploaded_at: string;
  sequence: number;
  frame_base64: string;
};

export type MobilePromptRecord = {
  id: string;
  credential_id: string;
  edge_id: string;
  client_message_id?: string;
  text: string;
  attachments?: MobilePromptAttachmentRecord[];
  status: string;
  created_at: string;
  processing_started_at?: string;
  processing_lease_until?: string;
  replied_at?: string;
  reply_id?: string;
  run_id?: string;
};

export type MobileReplyRecord = {
  id: string;
  prompt_id: string;
  credential_id: string;
  edge_id: string;
  role: string;
  text: string;
  run_id?: string;
  created_at: string;
  sequence: number;
};

export type ListPendingPromptsInput = {
  credentialId: string;
  controllerToken: string;
  limit?: number;
};

export type GetPromptInput = {
  credentialId: string;
  controllerToken: string;
  promptId: string;
};

export type GetLatestClaimedPairingInput = {
  edgeId: string;
  controllerToken: string;
};

export type CreatePromptReplyInput = {
  credentialId: string;
  promptId: string;
  controllerToken: string;
  text: string;
  role?: string;
  runId?: string;
};

export type FetchScreenSnapshotInput = {
  credentialId: string;
  controllerToken: string;
};

export type FetchScreenSnapshotResult = {
  snapshot: ScreenSnapshotRecord;
  ageMs: number | null;
  capturedAt: string | null;
};

export type DownloadPromptAttachmentInput = {
  credentialId: string;
  controllerToken: string;
  attachmentId: string;
};

export type DownloadPromptAttachmentResult = {
  attachmentId: string;
  mimeType: string;
  fileName: string;
  content: Uint8Array;
};

export type GetCommandInput = {
  credentialId: string;
  controllerToken: string;
  commandId: string;
};

export type WaitForCommandAckOptions = GetCommandInput & {
  timeoutMs?: number;
  pollIntervalMs?: number;
  signal?: AbortSignal;
};

export type WaitForCommandAckResult = {
  command: QueuedCommandRecord;
  iterations: number;
  acked: boolean;
};

export type ZhiHandControlAction =
  | "click"
  | "long_click"
  | "move"
  | "move_to"
  | "swipe"
  | "back"
  | "home"
  | "input_text"
  | "open_app"
  | "set_clipboard"
  | "start_live_capture"
  | "stop_live_capture";

export type ZhiHandControlCommandInput =
  | { action: "click"; xRatio: number; yRatio: number }
  | { action: "long_click"; xRatio: number; yRatio: number; durationMs?: number }
  | { action: "move"; dxRatio: number; dyRatio: number }
  | { action: "move_to"; xRatio: number; yRatio: number }
  | {
      action: "swipe";
      x1Ratio: number;
      y1Ratio: number;
      x2Ratio: number;
      y2Ratio: number;
      durationMs?: number;
    }
  | { action: "back" }
  | { action: "home" }
  | { action: "enter" }
  | { action: "input_text"; text: string; mode?: "auto" | "paste" | "type"; submit?: boolean }
  | { action: "open_app"; packageName: string }
  | { action: "set_clipboard"; text: string }
  | { action: "start_live_capture" }
  | { action: "stop_live_capture" };

export type FetchLike = typeof fetch;

const ZHIHAND_OPENCLAW_USER_AGENT =
  "ZhiHand-OpenClaw/0.5.0 (+https://zhihand.com)";

type PromptQueueResponse = {
  items: MobilePromptRecord[];
};

type PromptRecordResponse = {
  prompt: MobilePromptRecord;
};

type ReplyQueueResponse = {
  items: MobileReplyRecord[];
};

type ReplyRecordResponse = {
  reply: MobileReplyRecord;
};

export function createManifest(): OpenClawPluginManifest {
  return {
    name: "zhihand",
    version: "0.5.0",
    description: "ZhiHand control-plane and runtime adapter for OpenClaw",
    capabilities: [
      "control.execute",
      "control.stream",
      "capability.discovery",
      "pairing.bootstrap",
      "pairing.poll",
      "control.queue",
      "mobile.chat"
    ]
  };
}

export function resolveEndpoint(config: ZhiHandPluginConfig): string {
  return stripTrailingSlash(config.endpoint ?? "http://127.0.0.1:8787");
}

export function resolveControlPlaneEndpoint(config: ZhiHandPluginConfig): string {
  const endpoint = config.controlPlaneEndpoint?.trim() || DEFAULT_CONTROL_PLANE_ENDPOINT;
  return stripTrailingSlash(endpoint);
}

export function createEventStreamURL(
  config: ZhiHandPluginConfig,
  options: {
    clientId: string;
    topics?: string[];
  }
): string {
  const url = new URL(`${resolveEndpoint(config)}/v1/events/stream`);
  url.searchParams.set("client_id", options.clientId);
  for (const topic of options.topics ?? []) {
    url.searchParams.append("topic", topic);
  }
  return url.toString();
}

export async function fetchServerInfo(
  config: ZhiHandPluginConfig,
  fetchImpl: FetchLike = fetch
): Promise<ServerInfo> {
  return requestJSON<ServerInfo>({
    baseURL: resolveEndpoint(config),
    fetchImpl,
    timeoutMs: config.timeoutMs,
    path: "/v1/server/info",
    apiKey: config.apiKey
  });
}

export async function listCapabilities(
  config: ZhiHandPluginConfig,
  fetchImpl: FetchLike = fetch
): Promise<Capability[]> {
  const payload = await requestJSON<{ items: Capability[] }>({
    baseURL: resolveEndpoint(config),
    fetchImpl,
    timeoutMs: config.timeoutMs,
    path: "/v1/capabilities",
    apiKey: config.apiKey
  });
  return payload.items;
}

export async function executeAction(
  config: ZhiHandPluginConfig,
  action: ActionInput,
  fetchImpl: FetchLike = fetch
): Promise<ExecuteActionResponse> {
  return requestJSON<ExecuteActionResponse>({
    baseURL: resolveEndpoint(config),
    fetchImpl,
    timeoutMs: config.timeoutMs,
    path: "/v1/actions/execute",
    apiKey: config.apiKey,
    init: {
      method: "POST",
      body: JSON.stringify({ action })
    }
  });
}

export async function registerPlugin(
  config: ZhiHandPluginConfig,
  input: RegisterPluginInput,
  fetchImpl: FetchLike = fetch
): Promise<PluginRecord> {
  const payload = await requestJSON<{ plugin: PluginRecord }>({
    baseURL: resolveControlPlaneEndpoint(config),
    fetchImpl,
    timeoutMs: config.timeoutMs,
    path: "/v1/plugins",
    apiKey: config.apiKey,
    init: {
      method: "POST",
      body: JSON.stringify({
        adapter_kind: input.adapterKind,
        display_name: input.displayName,
        origin_listener: input.originListener,
        plugin_public_key: input.pluginPublicKey,
        stable_identity: input.stableIdentity
      })
    }
  });
  return payload.plugin;
}

export async function createPairingSession(
  config: ZhiHandPluginConfig,
  input: CreatePairingSessionInput,
  fetchImpl: FetchLike = fetch
): Promise<PairingSession> {
  const payload = await requestJSON<{ session: PairingSession; controller_token?: string }>({
    baseURL: resolveControlPlaneEndpoint(config),
    fetchImpl,
    timeoutMs: config.timeoutMs,
    path: "/v1/pairing/sessions",
    apiKey: config.apiKey,
    init: {
      method: "POST",
      body: JSON.stringify({
        edge_id: input.edgeId,
        ttl_seconds: input.ttlSeconds,
        requested_scopes: input.requestedScopes
      })
    }
  });
  return {
    ...payload.session,
    controller_token: payload.controller_token ?? payload.session.controller_token
  };
}

export async function getPairingSession(
  config: ZhiHandPluginConfig,
  sessionId: string,
  fetchImpl: FetchLike = fetch
): Promise<PairingSession> {
  const payload = await requestJSON<{ session: PairingSession }>({
    baseURL: resolveControlPlaneEndpoint(config),
    fetchImpl,
    timeoutMs: config.timeoutMs,
    path: `/v1/pairing/sessions/${encodeURIComponent(sessionId)}`,
    apiKey: config.apiKey
  });
  return payload.session;
}

export async function getLatestClaimedPairingSession(
  config: ZhiHandPluginConfig,
  input: GetLatestClaimedPairingInput,
  fetchImpl: FetchLike = fetch
): Promise<PairingSession> {
  const payload = await requestJSON<{ session: PairingSession; controller_token?: string }>({
    baseURL: resolveControlPlaneEndpoint(config),
    fetchImpl,
    timeoutMs: config.timeoutMs,
    path: `/v1/plugins/${encodeURIComponent(input.edgeId)}/active-pairing`,
    apiKey: config.apiKey,
    init: {
      headers: {
        "x-zhihand-controller-token": input.controllerToken
      }
    }
  });
  return {
    ...payload.session,
    controller_token: payload.controller_token ?? payload.session.controller_token
  };
}

export async function waitForClaim(
  config: ZhiHandPluginConfig,
  options: WaitForClaimOptions,
  fetchImpl: FetchLike = fetch
): Promise<WaitForClaimResult> {
  const timeoutAt = Date.now() + (options.timeoutMs ?? 60_000);
  const pollIntervalMs = options.pollIntervalMs ?? 1_500;
  let iterations = 0;

  while (true) {
    if (options.signal?.aborted) {
      throw abortError();
    }

    const session = await getPairingSession(config, options.sessionId, fetchImpl);
    iterations += 1;

    if (session.status === "claimed") {
      return {
        session,
        iterations,
        claimed: true,
        expired: false
      };
    }

    if (session.status === "expired") {
      return {
        session,
        iterations,
        claimed: false,
        expired: true
      };
    }

    if (Date.now() >= timeoutAt) {
      throw new Error(`Timed out waiting for pairing session ${options.sessionId} to be claimed`);
    }

    await delay(pollIntervalMs, options.signal);
  }
}

export async function renderPairingQRCodeSVG(
  pairURL: string,
  options: QRCodeRenderOptions = {}
): Promise<string> {
  return QRCode.toString(pairURL, {
    type: "svg",
    margin: options.margin ?? 1,
    width: options.width ?? 320,
    color: {
      dark: options.darkColor ?? "#101820",
      light: options.lightColor ?? "#ffffffff"
    }
  });
}

export async function buildPairingPrompt(
  session: PairingSession,
  options: {
    appDownloadURL?: string;
    qr?: QRCodeRenderOptions;
  } = {}
): Promise<PairingPrompt> {
  const appDownloadURL = options.appDownloadURL ?? "https://zhihand.com/download";
  const qrSVG = await renderPairingQRCodeSVG(session.pair_url, options.qr);
  const scopes = (session.requested_scopes ?? []).length > 0
    ? `Requested scopes: ${(session.requested_scopes ?? []).join(", ")}.`
    : "Requested scopes: observe, session.control.";

  return {
    title: "Pair ZhiHand",
    body: `Download the ZhiHand app, open it, and scan this QR code. ${scopes} The code expires at ${session.expires_at}.`,
    appDownloadURL,
    pairURL: session.pair_url,
    qrSVG
  };
}

export async function enqueueCommand(
  config: ZhiHandPluginConfig,
  input: EnqueueCommandInput,
  fetchImpl: FetchLike = fetch
): Promise<QueuedCommandRecord> {
  const payload = await requestJSON<{ command: QueuedCommandRecord }>({
    baseURL: resolveControlPlaneEndpoint(config),
    fetchImpl,
    timeoutMs: config.timeoutMs,
    path: `/v1/credentials/${encodeURIComponent(input.credentialId)}/commands`,
    init: {
      method: "POST",
      body: JSON.stringify({
        command: {
          ...input.command,
          message_id: input.command.messageId ?? Date.now()
        }
      }),
      headers: {
        "x-zhihand-controller-token": input.controllerToken
      }
    }
  });
  return payload.command;
}

export async function enqueueMobilePrompt(
  config: ZhiHandPluginConfig,
  input: EnqueueMobilePromptInput,
  fetchImpl: FetchLike = fetch
): Promise<MobilePromptRecord> {
  const payload = await requestJSON<PromptRecordResponse>({
    baseURL: resolveControlPlaneEndpoint(config),
    fetchImpl,
    timeoutMs: config.timeoutMs,
    path: `/v1/credentials/${encodeURIComponent(input.credentialId)}/prompts`,
    init: {
      method: "POST",
      body: JSON.stringify({
        text: input.text,
        client_message_id: input.clientMessageId,
        attachment_ids: input.attachmentIds
      }),
      headers: {
        authorization: `Bearer ${input.credentialSecret}`
      }
    }
  });
  return payload.prompt;
}

export async function downloadPromptAttachmentContent(
  config: ZhiHandPluginConfig,
  input: DownloadPromptAttachmentInput,
  fetchImpl: FetchLike = fetch
): Promise<DownloadPromptAttachmentResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs ?? 20_000);

  try {
    const response = await fetchImpl(
      `${resolveControlPlaneEndpoint(config)}/v1/credentials/${encodeURIComponent(input.credentialId)}/attachments/${encodeURIComponent(input.attachmentId)}/content`,
      {
        method: "GET",
        headers: {
          ...buildHeaders(),
          "x-zhihand-controller-token": input.controllerToken
        },
        signal: controller.signal
      }
    );

    if (!response.ok) {
      let message = `Attachment fetch returned ${response.status}.`;
      try {
        const payload = (await response.json()) as { error?: string };
        if (typeof payload.error === "string" && payload.error.trim()) {
          message = payload.error.trim();
        }
      } catch {
        // Ignore JSON parse failures for binary responses.
      }
      throw new Error(message);
    }

    const arrayBuffer = await response.arrayBuffer();
    const contentDisposition = response.headers.get("content-disposition") ?? "";
    const fileNameMatch = contentDisposition.match(/filename=\"?([^\";]+)\"?/i);
    return {
      attachmentId: input.attachmentId,
      mimeType: response.headers.get("content-type") ?? "application/octet-stream",
      fileName: fileNameMatch?.[1]?.trim() || input.attachmentId,
      content: new Uint8Array(arrayBuffer)
    };
  } finally {
    clearTimeout(timeout);
  }
}

export async function listPendingPrompts(
  config: ZhiHandPluginConfig,
  input: ListPendingPromptsInput,
  fetchImpl: FetchLike = fetch
): Promise<MobilePromptRecord[]> {
  const params = new URLSearchParams();
  if (input.limit != null) {
    params.set("limit", String(input.limit));
  }
  const suffix = params.size > 0 ? `?${params.toString()}` : "";
  const payload = await requestJSON<PromptQueueResponse>({
    baseURL: resolveControlPlaneEndpoint(config),
    fetchImpl,
    timeoutMs: config.timeoutMs,
    path: `/v1/credentials/${encodeURIComponent(input.credentialId)}/prompts${suffix}`,
    init: {
      method: "GET",
      headers: {
        "x-zhihand-controller-token": input.controllerToken
      }
    }
  });
  return payload.items;
}

export async function getPrompt(
  config: ZhiHandPluginConfig,
  input: GetPromptInput,
  fetchImpl: FetchLike = fetch
): Promise<MobilePromptRecord> {
  const payload = await requestJSON<PromptRecordResponse>({
    baseURL: resolveControlPlaneEndpoint(config),
    fetchImpl,
    timeoutMs: config.timeoutMs,
    path: `/v1/credentials/${encodeURIComponent(input.credentialId)}/prompts/${encodeURIComponent(input.promptId)}`,
    init: {
      method: "GET",
      headers: {
        "x-zhihand-controller-token": input.controllerToken
      }
    }
  });
  return payload.prompt;
}

export async function createPromptReply(
  config: ZhiHandPluginConfig,
  input: CreatePromptReplyInput,
  fetchImpl: FetchLike = fetch
): Promise<MobileReplyRecord> {
  const payload = await requestJSON<ReplyRecordResponse>({
    baseURL: resolveControlPlaneEndpoint(config),
    fetchImpl,
    timeoutMs: config.timeoutMs,
    path: `/v1/credentials/${encodeURIComponent(input.credentialId)}/prompts/${encodeURIComponent(input.promptId)}/reply`,
    init: {
      method: "POST",
      body: JSON.stringify({
        role: input.role ?? "assistant",
        text: input.text,
        run_id: input.runId
      }),
      headers: {
        "x-zhihand-controller-token": input.controllerToken
      }
    }
  });
  return payload.reply;
}

export async function getCommand(
  config: ZhiHandPluginConfig,
  input: GetCommandInput,
  fetchImpl: FetchLike = fetch
): Promise<QueuedCommandRecord> {
  const payload = await requestJSON<{ command: QueuedCommandRecord }>({
    baseURL: resolveControlPlaneEndpoint(config),
    fetchImpl,
    timeoutMs: config.timeoutMs,
    path: `/v1/credentials/${encodeURIComponent(input.credentialId)}/commands/${encodeURIComponent(input.commandId)}`,
    init: {
      method: "GET",
      headers: {
        "x-zhihand-controller-token": input.controllerToken
      }
    }
  });
  return payload.command;
}

export async function waitForCommandAck(
  config: ZhiHandPluginConfig,
  options: WaitForCommandAckOptions,
  fetchImpl: FetchLike = fetch
): Promise<WaitForCommandAckResult> {
  const timeoutAt = Date.now() + (options.timeoutMs ?? 10_000);
  const pollIntervalMs = options.pollIntervalMs ?? 500;
  let iterations = 0;

  while (true) {
    if (options.signal?.aborted) {
      throw abortError();
    }

    const command = await getCommand(config, options, fetchImpl);
    iterations += 1;
    if (command.acked_at) {
      return {
        command,
        iterations,
        acked: true
      };
    }

    if (Date.now() >= timeoutAt) {
      return {
        command,
        iterations,
        acked: false
      };
    }

    await delay(pollIntervalMs, options.signal);
  }
}

export async function fetchLatestScreenSnapshot(
  config: ZhiHandPluginConfig,
  input: FetchScreenSnapshotInput,
  fetchImpl: FetchLike = fetch
): Promise<FetchScreenSnapshotResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs ?? 10_000);

  try {
    const response = await fetchImpl(
      `${resolveControlPlaneEndpoint(config)}/v1/credentials/${encodeURIComponent(input.credentialId)}/screen`,
      {
        method: "GET",
        headers: {
          ...buildHeaders(),
          "x-zhihand-controller-token": input.controllerToken
        },
        signal: controller.signal
      }
    );
    const payload = (await response.json()) as
      | { snapshot: ScreenSnapshotRecord }
      | { error?: string | { message?: string } };

    if (!response.ok) {
      throw new Error(extractErrorMessage(payload, response.status));
    }

    const ageHeader = response.headers.get("x-snapshot-age");
    const capturedAt = response.headers.get("x-snapshot-captured-at");
    return {
      snapshot: (payload as { snapshot: ScreenSnapshotRecord }).snapshot,
      ageMs: ageHeader == null || ageHeader === "" ? null : Number.parseInt(ageHeader, 10),
      capturedAt
    };
  } finally {
    clearTimeout(timeout);
  }
}

export function createControlCommand(input: ZhiHandControlCommandInput): QueuedControlCommand {
  switch (input.action) {
    case "click":
      return {
        type: "receive_click",
        payload: {
          x: normalizeRatio(input.xRatio, "xRatio"),
          y: normalizeRatio(input.yRatio, "yRatio")
        }
      };
    case "long_click":
      return {
        type: "receive_longclick",
        payload: {
          x: normalizeRatio(input.xRatio, "xRatio"),
          y: normalizeRatio(input.yRatio, "yRatio"),
          time: input.durationMs ?? 600
        }
      };
    case "move":
      return {
        type: "receive_move",
        payload: {
          x: normalizeSignedRatio(input.dxRatio, "dxRatio"),
          y: normalizeSignedRatio(input.dyRatio, "dyRatio")
        }
      };
    case "move_to":
      return {
        type: "receive_moveto",
        payload: {
          x: normalizeRatio(input.xRatio, "xRatio"),
          y: normalizeRatio(input.yRatio, "yRatio")
        }
      };
    case "swipe":
      return {
        type: "receive_slide",
        payload: {
          x1: normalizeRatio(input.x1Ratio, "x1Ratio"),
          y1: normalizeRatio(input.y1Ratio, "y1Ratio"),
          x2: normalizeRatio(input.x2Ratio, "x2Ratio"),
          y2: normalizeRatio(input.y2Ratio, "y2Ratio"),
          time: input.durationMs ?? 500
        }
      };
    case "back":
      return {
        type: "receive_back",
        payload: {}
      };
    case "home":
      return {
        type: "receive_home",
        payload: {}
      };
    case "enter":
      return {
        type: "receive_enter",
        payload: {}
      };
    case "input_text":
      return {
        type: "receive_input",
        payload: {
          input: input.text,
          mode: input.mode ?? "auto",
          submit: input.submit ?? false
        }
      };
    case "open_app":
      return {
        type: "receive_app",
        payload: { app_package: input.packageName }
      };
    case "set_clipboard":
      return {
        type: "receive_clipboard",
        payload: { clipboard: input.text }
      };
    case "start_live_capture":
      return {
        type: "zhihand.start_live_capture",
        payload: {}
      };
    case "stop_live_capture":
      return {
        type: "zhihand.stop_live_capture",
        payload: {}
      };
    default:
      return exhaustiveControlCommand(input);
  }
}

function normalizeRatio(value: number, name: string): number {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(`${name} must be a normalized ratio in [0, 1].`);
  }
  return value;
}

function normalizeSignedRatio(value: number, name: string): number {
  if (!Number.isFinite(value) || value < -1 || value > 1) {
    throw new Error(`${name} must be a normalized ratio in [-1, 1].`);
  }
  return value;
}

type RequestJSONOptions = {
  baseURL: string;
  path: string;
  fetchImpl: FetchLike;
  timeoutMs?: number;
  apiKey?: string;
  init?: RequestInit;
};

async function requestJSON<T>({
  baseURL,
  path,
  fetchImpl,
  timeoutMs = 10_000,
  apiKey,
  init = {}
}: RequestJSONOptions): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetchImpl(`${stripTrailingSlash(baseURL)}${path}`, {
      ...init,
      headers: {
        ...buildJSONHeaders(init.body),
        ...buildHeaders(apiKey),
        ...(init.headers ?? {})
      },
      signal: controller.signal
    });

    const payload = (await response.json()) as
      | T
      | { error?: { message?: string } }
      | { error?: string };

    if (!response.ok) {
      throw new Error(extractErrorMessage(payload, response.status));
    }

    return payload as T;
  } finally {
    clearTimeout(timeout);
  }
}

function buildHeaders(apiKey?: string): Record<string, string> {
  const headers: Record<string, string> = {
    "User-Agent": ZHIHAND_OPENCLAW_USER_AGENT
  };

  if (apiKey) {
    headers.authorization = `Bearer ${apiKey}`;
  }

  return headers;
}

function buildJSONHeaders(body: RequestInit["body"]): Record<string, string> {
  return body == null
    ? {}
    : {
        "content-type": "application/json"
      };
}

function extractErrorMessage(payload: unknown, status: number): string {
  if (typeof payload === "object" && payload !== null) {
    if ("error" in payload) {
      const error = payload.error;
      if (typeof error === "string" && error.trim() !== "") {
        return error;
      }
      if (
        typeof error === "object" &&
        error !== null &&
        "message" in error &&
        typeof error.message === "string" &&
        error.message.trim() !== ""
      ) {
        return error.message;
      }
    }
  }

  return `Request failed with status ${status}`;
}

function stripTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function abortError(): Error {
  const error = new Error("The operation was aborted");
  error.name = "AbortError";
  return error;
}

function exhaustiveControlCommand(input: never): never {
  throw new Error(`Unsupported control command: ${JSON.stringify(input)}`);
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      resolve();
    }, ms);

    const abortListener = () => {
      cleanup();
      reject(abortError());
    };

    const cleanup = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abortListener);
    };

    if (signal) {
      if (signal.aborted) {
        cleanup();
        reject(abortError());
        return;
      }
      signal.addEventListener("abort", abortListener, { once: true });
    }
  });
}

import os from "node:os";

import {
  buildPairingPrompt,
  collectCredentialEvents,
  createPromptReply,
  createPairingSession,
  createControlCommand,
  fetchLatestScreenSnapshot,
  getDeviceProfile,
  getPrompt,
  getPairingSession,
  getLatestClaimedPairingSession,
  registerPlugin,
  type ControlPlaneStreamEvent,
  type DeviceProfileRecord,
  type MobilePromptRecord,
  type PairingSession,
  type PluginRecord,
  type QueuedCommandRecord,
  type ScreenSnapshotRecord,
  waitForCommandAck,
  enqueueCommand,
  type ZhiHandPluginConfig
} from "./index.ts";
import {
  buildNativeMobileAgentInstructions,
  runNativeMobileAgent
} from "./native_mobile_agent.ts";
import { prepareMobilePromptInput } from "./mobile_prompt_media.ts";
import type { OpenClawPluginApi } from "./openclaw_api.ts";
import { OPENCLAW_PACKAGE_VERSION } from "./package_metadata.ts";
import {
  formatPluginUpdateDetails,
  formatPluginUpdateSummary,
  prepareLatestPluginUpdateInstruction,
  resolvePluginUpdateStatus
} from "./plugin_update.ts";
import {
  loadState,
  saveState,
  type StoredPairingState,
  type StoredPluginState
} from "./state_store.ts";
import { cacheScreenSnapshot } from "./cache_store.ts";

type PluginConfig = {
  controlPlaneEndpoint?: string;
  originListener?: string;
  displayName?: string;
  stableIdentity?: string;
  pairingTTLSeconds?: number;
  appDownloadURL?: string;
  gatewayResponsesEndpoint?: string;
  gatewayAuthToken?: string;
  mobileAgentId?: string;
  requestedScopes?: string[];
  updateCheckEnabled?: boolean;
  updateCheckIntervalHours?: number;
};

export function formatPairingCommandText(
  appDownloadURL: string,
  qrURL: string,
  nextStep: string = "run /zhihand status"
): string {
  return [
    "ZhiHand pairing QR created.",
    `Download app: ${appDownloadURL}`,
    `QR URL: ${qrURL}`,
    `Open the QR URL in a browser, scan it in the ZhiHand app, then ${nextStep}.`
  ].join("\n");
}

const DEFAULT_CONTROL_PLANE_ENDPOINT = "https://api.zhihand.com";
const DEFAULT_DOWNLOAD_URL = "https://zhihand.com/download";
const DEFAULT_REQUESTED_SCOPES = [
  "observe",
  "session.control",
  "screen.read",
  "screen.capture",
  "ble.control"
];
const DEFAULT_GATEWAY_RESPONSES_ENDPOINT = "http://127.0.0.1:18789/v1/responses";
const DEFAULT_MOBILE_AGENT_ID = "zhihand-mobile";
const PROMPT_RELAY_IDLE_MS = 1_500;
const PROMPT_RELAY_ERROR_MS = 3_000;
const PROMPT_RELAY_MAX_ERROR_MS = 30_000;
const PROMPT_CANCEL_POLL_MS = 500;
const CONTROL_SETTLE_MS = 2_000;
const MAX_FRESH_SCREEN_AGE_MS = 10_000;
const RELAY_RUNTIME_KEY = Symbol.for("zhihand.promptRelay.runtime");

type PromptRelayRuntime = {
  stopped: boolean;
  loopPromise: Promise<void> | null;
  streamAbortController: AbortController | null;
};

let lastRelayIdleReason = "";
const activePromptRuns = new Map<string, AbortController>();

export default function register(api: OpenClawPluginApi) {
  api.registerService(createPluginUpdateService(api));
  api.registerService(createPromptRelayService(api));

  api.registerCommand({
    name: "zhihand",
    description: "Pair ZhiHand, inspect current pairing state, and prepare phone control.",
    acceptsArgs: true,
    handler: async (ctx: any) => {
      const args = ctx.args?.trim() ?? "";
      const tokens = args.split(/\s+/).filter(Boolean);
      const action = tokens[0]?.toLowerCase() ?? "status";

      if (action === "pair" || action === "qr") {
        return await handlePairCommand(api);
      }
      if (action === "status") {
        return await handleStatusCommand(api);
      }
      if (action === "unpair" || action === "forget") {
        return await handleUnpairCommand(api);
      }
      if (action === "update" || action === "upgrade") {
        return await handleUpdateCommand(api, tokens.slice(1));
      }
      return {
        text: [
          "ZhiHand commands:",
          "",
          "/zhihand pair",
          "/zhihand status",
          "/zhihand unpair",
          "/zhihand update",
          "/zhihand update check"
        ].join("\n")
      };
    }
  });

  api.registerTool({
    name: "zhihand_pair",
    label: "ZhiHand Pair",
    description: "Create a ZhiHand pairing QR flow and return the pairing link for the ZhiHand mobile app.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {}
    },
    execute: async () => {
      const result = await createOrRefreshPairing(api, { forceNew: true });
      const prompt = await buildPairingPrompt(result.session, {
        appDownloadURL: resolvePluginConfig(api).appDownloadURL ?? DEFAULT_DOWNLOAD_URL
      });
      return {
        content: [
          {
            type: "text",
            text: formatPairingCommandText(
              prompt.appDownloadURL,
              prompt.pairURL,
              "call zhihand_status"
            )
          }
        ],
        details: {
          edgeId: result.plugin.edge_id,
          edgeHost: result.plugin.edge_host,
          sessionId: result.session.id,
          pairUrl: result.session.pair_url
        }
      };
    }
  }, { optional: true });

  api.registerTool({
    name: "zhihand_status",
    label: "ZhiHand Status",
    description: "Show the current ZhiHand pairing state and whether the latest phone screen is available.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {}
    },
    execute: async () => {
      const status = await resolveStatus(api);
      return {
        content: [
          {
            type: "text",
            text: formatStatusText(status)
          }
        ],
        details: status
      };
    }
  }, { optional: true });

  api.registerTool({
    name: "zhihand_screen_read",
    label: "ZhiHand Screen",
    description: "Fetch the latest uploaded ZhiHand phone screen snapshot for the paired ZhiHand mobile app.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {}
    },
    execute: async () => {
      const active = await ensureClaimedPairing(api);
      const snapshot = await fetchLatestScreenSnapshot(
        { controlPlaneEndpoint: resolveControlPlaneEndpoint(api) },
        {
          credentialId: active.credentialId,
          controllerToken: active.controllerToken
        }
      );
      assertFreshScreenSnapshot(snapshot);
      const screenPath = await cacheScreenSnapshot(api, snapshot.snapshot);
      return {
        content: [
          {
            type: "text",
            text: formatSnapshotSummary(snapshot)
          },
          {
            type: "image",
            data: snapshot.snapshot.frame_base64,
            mimeType: snapshot.snapshot.mime_type
          }
        ],
        details: {
          path: screenPath,
          ageMs: snapshot.ageMs,
          capturedAt: snapshot.capturedAt,
          width: snapshot.snapshot.width,
          height: snapshot.snapshot.height,
          sequence: snapshot.snapshot.sequence
        }
      };
    }
  }, { optional: true });

  api.registerTool({
    name: "zhihand_control",
    label: "ZhiHand Control",
    description: "Queue a phone control action for the paired ZhiHand mobile app and wait for the command ACK.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        action: {
          type: "string",
          enum: [
            "click",
            "long_click",
            "move",
            "move_to",
            "swipe",
            "back",
            "home",
            "enter",
            "input_text",
            "open_app",
            "set_clipboard",
            "start_live_capture",
            "stop_live_capture"
          ]
        },
        xRatio: {
          type: "number",
          minimum: 0,
          maximum: 1,
          description: "Normalized horizontal position in [0,1] from the latest screenshot."
        },
        yRatio: {
          type: "number",
          minimum: 0,
          maximum: 1,
          description: "Normalized vertical position in [0,1] from the latest screenshot."
        },
        dxRatio: {
          type: "number",
          minimum: -1,
          maximum: 1,
          description: "Normalized horizontal delta in [-1,1] for relative pointer movement."
        },
        dyRatio: {
          type: "number",
          minimum: -1,
          maximum: 1,
          description: "Normalized vertical delta in [-1,1] for relative pointer movement."
        },
        x1Ratio: {
          type: "number",
          minimum: 0,
          maximum: 1,
          description: "Normalized swipe start X in [0,1]."
        },
        y1Ratio: {
          type: "number",
          minimum: 0,
          maximum: 1,
          description: "Normalized swipe start Y in [0,1]."
        },
        x2Ratio: {
          type: "number",
          minimum: 0,
          maximum: 1,
          description: "Normalized swipe end X in [0,1]."
        },
        y2Ratio: {
          type: "number",
          minimum: 0,
          maximum: 1,
          description: "Normalized swipe end Y in [0,1]."
        },
        durationMs: { type: "number" },
        text: { type: "string" },
        mode: {
          type: "string",
          enum: ["auto", "paste", "type"],
          description: "Text input strategy. Use paste by default; use type only for sensitive fields or when paste fails."
        },
        submit: {
          type: "boolean",
          description: "If true, send Enter immediately after the text input completes."
        },
        packageName: { type: "string" }
      },
      required: ["action"]
    },
    execute: async (_id: string, params: Record<string, unknown>) => {
      const active = await ensureClaimedPairing(api);
      const command = await enqueueCommand(
        { controlPlaneEndpoint: resolveControlPlaneEndpoint(api) },
        {
          credentialId: active.credentialId,
          controllerToken: active.controllerToken,
          command: createControlCommand(readControlParams(params))
        }
      );
      const ack = await waitForCommandAck(
        { controlPlaneEndpoint: resolveControlPlaneEndpoint(api) },
        {
          credentialId: active.credentialId,
          controllerToken: active.controllerToken,
          commandId: command.id,
          timeoutMs: 6_000,
          pollIntervalMs: 400
        }
      );
      if (ack.acked && requiresUiSettleDelay(ack.command?.type)) {
        await sleep(CONTROL_SETTLE_MS);
      }
      return {
        content: [
          {
            type: "text",
            text: formatAckSummary(command, ack.command, ack.acked)
          }
        ],
        details: {
          queued: command,
          command: ack.command,
          acked: ack.acked
        }
      };
    }
  }, { optional: true });
}

function createPluginUpdateService(api: OpenClawPluginApi) {
  return {
    id: "plugin-update-check",
    start: async () => {
      void resolvePluginUpdateStatus(api, { logAvailable: true }).catch((error) => {
        api.logger.warn?.(`ZhiHand plugin update check failed: ${errorMessage(error)}`);
      });
    },
    stop: async () => {}
  };
}

function createPromptRelayService(api: OpenClawPluginApi) {
  return {
    id: "mobile-prompt-relay",
    start: async () => {
      ensurePromptRelayStarted(api);
    },
    stop: async () => {
      const runtime = getPromptRelayRuntime();
      runtime.stopped = true;
      runtime.streamAbortController?.abort();
      runtime.streamAbortController = null;
      for (const controller of activePromptRuns.values()) {
        controller.abort();
      }
      await runtime.loopPromise;
    }
  };
}

function getPromptRelayRuntime(): PromptRelayRuntime {
  const registry = globalThis as typeof globalThis & {
    [RELAY_RUNTIME_KEY]?: PromptRelayRuntime;
  };
  registry[RELAY_RUNTIME_KEY] ??= {
    stopped: false,
    loopPromise: null,
    streamAbortController: null
  };
  return registry[RELAY_RUNTIME_KEY]!;
}

function ensurePromptRelayStarted(api: OpenClawPluginApi) {
  const runtime = getPromptRelayRuntime();
  if (runtime.loopPromise) {
    return;
  }
  try {
    validatePromptRelayConfig(api);
  } catch (error) {
    api.logger.error?.(`ZhiHand prompt relay disabled: ${errorMessage(error)}`);
    return;
  }
  runtime.stopped = false;
  api.logger.info?.("ZhiHand prompt relay starting.");
  runtime.loopPromise = runPromptRelayLoop(api, () => runtime.stopped)
    .catch((error) => {
      api.logger.error?.(`ZhiHand prompt relay crashed: ${errorMessage(error)}`);
    })
    .finally(() => {
      runtime.loopPromise = null;
    });
}

async function runPromptRelayLoop(
  api: OpenClawPluginApi,
  isStopped: () => boolean
): Promise<void> {
  let consecutiveFailures = 0;
  api.logger.info?.(
    `ZhiHand prompt relay loop ready for ${resolveControlPlaneEndpoint(api)} via ${resolveGatewayResponsesEndpoint(api)} (${resolveMobileAgentId(api)})`
  );
  while (!isStopped()) {
    try {
      const active = await getClaimedPairingForRelay(api);
      if (!active) {
        await sleep(PROMPT_RELAY_IDLE_MS);
        continue;
      }
      lastRelayIdleReason = "";
      consecutiveFailures = 0;
      const runtime = getPromptRelayRuntime();
      runtime.streamAbortController = new AbortController();
      await collectCredentialEvents(
        { controlPlaneEndpoint: resolveControlPlaneEndpoint(api) },
        {
          credentialId: active.credentialId,
          controllerToken: active.controllerToken,
          topics: ["prompts"],
          signal: runtime.streamAbortController.signal
        },
        async (event) => {
          if (isStopped()) {
            return;
          }
          await handleRelayStreamEvent(api, active, event);
        }
      );
      runtime.streamAbortController = null;
    } catch (error) {
      if (isStopped() && isAbortError(error)) {
        return;
      }
      getPromptRelayRuntime().streamAbortController = null;
      consecutiveFailures += 1;
      const delayMs = Math.min(
        PROMPT_RELAY_MAX_ERROR_MS,
        PROMPT_RELAY_ERROR_MS * Math.max(1, 2 ** (consecutiveFailures - 1))
      );
      api.logger.warn?.(`ZhiHand prompt relay delayed: ${errorMessage(error)}`);
      await sleep(delayMs);
    }
  }
}

async function handleRelayStreamEvent(
  api: OpenClawPluginApi,
  pairing: StoredPairingState,
  event: ControlPlaneStreamEvent
): Promise<void> {
  if (event.topic !== "prompts" || !event.prompt) {
    return;
  }
  const prompt = event.prompt;
  if (prompt.status !== "pending" && prompt.status !== "processing") {
    return;
  }
  try {
    await processMobilePrompt(api, pairing, prompt);
  } catch (error) {
    api.logger.warn?.(`ZhiHand prompt relay worker failed: ${errorMessage(error)}`);
  }
}

async function processMobilePrompt(
  api: OpenClawPluginApi,
  pairing: StoredPairingState,
  prompt: MobilePromptRecord
): Promise<void> {
  let runId = "";
  const abortController = new AbortController();
  const promptKey = buildActivePromptRunKey(pairing.credentialId, prompt.id);
  if (activePromptRuns.has(promptKey)) {
    return;
  }
  activePromptRuns.set(promptKey, abortController);
  const stopWatchingCancellation = watchPromptCancellation(
    api,
    pairing,
    prompt.id,
    abortController
  );
  try {
    const deviceProfile = await getDeviceProfile(
      { controlPlaneEndpoint: resolveControlPlaneEndpoint(api) },
      {
        credentialId: pairing.credentialId,
        controllerToken: pairing.controllerToken
      }
    ).catch(() => null);
    const preparedPrompt = await prepareMobilePromptInput(
      api,
      { controlPlaneEndpoint: resolveControlPlaneEndpoint(api) },
      pairing,
      prompt
    );
    const promptWithProfile = withDeviceProfileContext(preparedPrompt, deviceProfile);
    const completion = await runOpenClawNativeMobileAgent(
      api,
      pairing,
      promptWithProfile,
      abortController.signal
    );
    runId = completion.runId;
    await createPromptReply(
      { controlPlaneEndpoint: resolveControlPlaneEndpoint(api) },
      {
        credentialId: pairing.credentialId,
        promptId: prompt.id,
        controllerToken: pairing.controllerToken,
        role: "assistant",
        text: completion.replyText,
        runId
      }
    );
  } catch (error) {
    const replyText = isAbortError(error)
      ? "Task stopped by the user."
      : `OpenClaw could not answer right now: ${errorMessage(error)}`;
    await createPromptReply(
      { controlPlaneEndpoint: resolveControlPlaneEndpoint(api) },
      {
        credentialId: pairing.credentialId,
        promptId: prompt.id,
        controllerToken: pairing.controllerToken,
        role: "system",
        text: replyText,
        runId
      }
    );
  } finally {
    stopWatchingCancellation();
    activePromptRuns.delete(promptKey);
  }
}

async function runOpenClawNativeMobileAgent(
  api: OpenClawPluginApi,
  pairing: StoredPairingState,
  prompt: { effectivePromptText: string; promptInput: any[] },
  signal?: AbortSignal
) : Promise<{ replyText: string; runId: string }> {
  return await runNativeMobileAgent({
    endpoint: resolveGatewayResponsesEndpoint(api),
    authToken: resolveGatewayAuthToken(api),
    agentId: resolveMobileAgentId(api),
    user: buildMobileAgentUser(pairing),
    promptText: prompt.effectivePromptText,
    promptInput: prompt.promptInput,
    instructions: buildNativeMobileAgentInstructions(),
    signal
  });
}

async function getClaimedPairingForRelay(api: OpenClawPluginApi): Promise<StoredPairingState | null> {
  const stateDir = api.runtime.state.resolveStateDir();
  const statePath = resolveStatePath(stateDir);
  const state = await loadState(stateDir);
  if (!state.pairing || !state.pairing.controllerToken) {
    logRelayIdleOnce(
      api,
      state.pairing
        ? `ZhiHand prompt relay waiting for a claimed pairing in ${statePath}.`
        : `ZhiHand prompt relay waiting for local pairing state in ${statePath}.`
    );
    return null;
  }

  try {
    const pairing = await refreshPairingSession(api, state);
    if (!pairing || pairing.status !== "claimed" || !pairing.credentialId || !pairing.controllerToken) {
      logRelayIdleOnce(
        api,
        `ZhiHand prompt relay waiting for a claimed pairing in ${statePath}.`
      );
      return null;
    }
    lastRelayIdleReason = "";
    return pairing;
  } catch (error) {
    api.logger.warn?.(`ZhiHand prompt relay pairing refresh failed: ${errorMessage(error)}`);
    return null;
  }
}

function logRelayIdleOnce(api: OpenClawPluginApi, message: string) {
  if (message === lastRelayIdleReason) {
    return;
  }
  lastRelayIdleReason = message;
  api.logger.info?.(message);
}

function watchPromptCancellation(
  api: OpenClawPluginApi,
  pairing: StoredPairingState,
  promptId: string,
  abortController: AbortController
): () => void {
  let stopped = false;
  const loop = async () => {
    while (!stopped && !abortController.signal.aborted) {
      try {
        const prompt = await getPrompt(
          { controlPlaneEndpoint: resolveControlPlaneEndpoint(api) },
          {
            credentialId: pairing.credentialId,
            promptId,
            controllerToken: pairing.controllerToken
          }
        );
        if (prompt.status === "cancelled") {
          abortController.abort();
          return;
        }
      } catch (error) {
        if (!stopped && !abortController.signal.aborted) {
          api.logger.warn?.(
            `ZhiHand prompt cancellation watcher failed for ${promptId}: ${errorMessage(error)}`
          );
        }
      }
      await sleep(PROMPT_CANCEL_POLL_MS);
    }
  };
  void loop();
  return () => {
    stopped = true;
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildActivePromptRunKey(credentialId: string, promptId: string): string {
  return `${credentialId}:${promptId}`;
}

async function handlePairCommand(api: OpenClawPluginApi): Promise<{ text: string }> {
  const result = await createOrRefreshPairing(api, { forceNew: true });
  const prompt = await buildPairingPrompt(result.session, {
    appDownloadURL: resolvePluginConfig(api).appDownloadURL ?? DEFAULT_DOWNLOAD_URL
  });
  return {
    text: formatPairingCommandText(prompt.appDownloadURL, prompt.pairURL)
  };
}

async function handleStatusCommand(api: OpenClawPluginApi): Promise<{ text: string }> {
  const status = await resolveStatus(api);
  return {
    text: formatStatusText(status)
  };
}

async function handleUpdateCommand(
  api: OpenClawPluginApi,
  args: string[]
): Promise<{ text: string }> {
  const action = args[0]?.toLowerCase() ?? "install";

  if (action === "check" || action === "status") {
    const status = await resolvePluginUpdateStatus(api, {
      force: true,
      allowDisabled: true
    });
    return {
      text: formatPluginUpdateDetails(status)
    };
  }

  if (action === "install" || action === "apply" || action === "upgrade") {
    return await prepareLatestPluginUpdateInstruction(api);
  }

  return {
    text: [
      "ZhiHand update commands:",
      "",
      "/zhihand update",
      "/zhihand update check"
    ].join("\n")
  };
}

async function handleUnpairCommand(api: OpenClawPluginApi): Promise<{ text: string }> {
  const stateDir = api.runtime.state.resolveStateDir();
  const state = await loadState(stateDir);
  await saveState(stateDir, { plugin: state.plugin });
  return {
    text: "ZhiHand pairing state cleared. Generate a new QR with /zhihand pair when needed."
  };
}

async function createOrRefreshPairing(
  api: OpenClawPluginApi,
  options: { forceNew: boolean }
): Promise<{ plugin: PluginRecord; session: PairingSession }> {
  const stateDir = api.runtime.state.resolveStateDir();
  const state = await loadState(stateDir);
  const plugin = await ensurePluginRegistration(api, state);
  const refreshed = state.pairing ? await refreshPairingSession(api, state) : null;
  if (!options.forceNew && refreshed?.status === "claimed") {
    return {
      plugin,
      session: await getPairingSession(
        { controlPlaneEndpoint: resolveControlPlaneEndpoint(api) },
        refreshed.sessionId
      )
    };
  }

  const pluginConfig = resolvePluginConfig(api);
  const session = await createPairingSession(
    { controlPlaneEndpoint: resolveControlPlaneEndpoint(api) },
    {
      edgeId: plugin.edge_id,
      ttlSeconds: normalizedPairingTTL(pluginConfig.pairingTTLSeconds),
      requestedScopes: pluginConfig.requestedScopes ?? DEFAULT_REQUESTED_SCOPES
    }
  );
  state.plugin = plugin;
  state.pairing = {
    sessionId: session.id,
    controllerToken: session.controller_token ?? "",
    edgeId: session.edge_id,
    edgeHost: session.edge_host,
    pairUrl: session.pair_url,
    qrPayload: session.qr_payload,
    credentialId: session.credential_id,
    status: session.status,
    expiresAt: session.expires_at
  };
  await saveState(stateDir, state);
  return { plugin, session };
}

async function resolveStatus(api: OpenClawPluginApi): Promise<Record<string, unknown>> {
  const stateDir = api.runtime.state.resolveStateDir();
  const state = await loadState(stateDir);
  const plugin = await ensurePluginRegistration(api, state);
  const pairing = await refreshPairingSession(api, state);
  const output: Record<string, unknown> = {
    pluginVersion: OPENCLAW_PACKAGE_VERSION,
    edgeId: plugin.edge_id,
    edgeHost: plugin.edge_host,
    pairingStatus: pairing?.status ?? "unpaired"
  };
  const pluginUpdate = await resolvePluginUpdateStatus(api);
  output.pluginUpdate = pluginUpdate;
  output.pluginUpdateSummary = formatPluginUpdateSummary(pluginUpdate);

  if (pairing?.pairUrl) {
    output.pairUrl = pairing.pairUrl;
  }
  if (pairing?.credentialId) {
    output.credentialId = pairing.credentialId;
    try {
      const profile = await getDeviceProfile(
        { controlPlaneEndpoint: resolveControlPlaneEndpoint(api) },
        {
          credentialId: pairing.credentialId,
          controllerToken: pairing.controllerToken
        }
      );
      output.deviceProfile = {
        platform: profile.platform,
        appVersion: profile.app_version,
        profileKey: profile.profile_key,
        brand: stringValue(profile.attributes?.brand),
        model: stringValue(profile.attributes?.model),
        romFamily: stringValue(profile.attributes?.rom_family),
        systemRelease: stringValue(profile.attributes?.system_release),
        fullAccessStrategyKey: stringValue(profile.attributes?.full_access_strategy_key)
      };
    } catch (error) {
      output.deviceProfileError = errorMessage(error);
    }
    try {
      const snapshot = await fetchLatestScreenSnapshot(
        { controlPlaneEndpoint: resolveControlPlaneEndpoint(api) },
        {
          credentialId: pairing.credentialId,
          controllerToken: pairing.controllerToken
        }
      );
      output.latestScreenAgeMs = snapshot.ageMs;
      output.latestScreenCapturedAt = snapshot.capturedAt;
      output.latestScreenWidth = snapshot.snapshot.width;
      output.latestScreenHeight = snapshot.snapshot.height;
      output.latestScreenSequence = snapshot.snapshot.sequence;
    } catch (error) {
      output.latestScreenError = errorMessage(error);
    }
  }

  return output;
}

async function ensureClaimedPairing(api: OpenClawPluginApi): Promise<StoredPairingState> {
  const stateDir = api.runtime.state.resolveStateDir();
  const state = await loadState(stateDir);
  await ensurePluginRegistration(api, state);
  const pairing = await refreshPairingSession(api, state);
  if (!pairing || pairing.status !== "claimed" || !pairing.credentialId) {
    throw new Error("No claimed ZhiHand pairing. Run /zhihand pair and scan the QR code first.");
  }
  return pairing;
}

async function ensurePluginRegistration(
  api: OpenClawPluginApi,
  state: StoredPluginState
): Promise<PluginRecord> {
  if (state.plugin) {
    return state.plugin;
  }

  const pluginConfig = resolvePluginConfig(api);
  const plugin = await registerPlugin(
    { controlPlaneEndpoint: resolveControlPlaneEndpoint(api) },
    {
      adapterKind: "openclaw",
      displayName: pluginConfig.displayName ?? `OpenClaw @ ${os.hostname()}`,
      originListener: pluginConfig.originListener?.trim(),
      stableIdentity: pluginConfig.stableIdentity ?? `openclaw-zhihand:${os.hostname()}`
    }
  );
  state.plugin = plugin;
  await saveState(api.runtime.state.resolveStateDir(), state);
  return plugin;
}

async function refreshPairingSession(
  api: OpenClawPluginApi,
  state: StoredPluginState
): Promise<StoredPairingState | null> {
  const pairing = state.pairing;
  if (!pairing) {
    return null;
  }

  const session = await getPairingSession(
    { controlPlaneEndpoint: resolveControlPlaneEndpoint(api) },
    pairing.sessionId
  );
  state.pairing = {
    ...pairing,
    edgeId: session.edge_id,
    edgeHost: session.edge_host,
    pairUrl: session.pair_url,
    qrPayload: session.qr_payload,
    credentialId: session.credential_id ?? pairing.credentialId,
    status: session.status,
    expiresAt: session.expires_at
  };
  if (state.pairing.status === "claimed" && state.pairing.controllerToken && state.pairing.edgeId) {
    const recovered = await tryRecoverLatestClaimedPairing(api, state.pairing);
    if (recovered) {
      state.pairing = recovered;
    }
  }
  await saveState(api.runtime.state.resolveStateDir(), state);
  return state.pairing;
}

async function tryRecoverLatestClaimedPairing(
  api: OpenClawPluginApi,
  pairing: StoredPairingState
): Promise<StoredPairingState | null> {
  try {
    const session = await getLatestClaimedPairingSession(
      { controlPlaneEndpoint: resolveControlPlaneEndpoint(api) },
      {
        edgeId: pairing.edgeId,
        controllerToken: pairing.controllerToken
      }
    );
    if (!session.credential_id || !session.controller_token) {
      return pairing;
    }
    if (
      session.id === pairing.sessionId &&
      session.credential_id === pairing.credentialId &&
      session.controller_token === pairing.controllerToken
    ) {
      return pairing;
    }
    api.logger.info?.(
      `ZhiHand pairing state advanced from ${pairing.sessionId}/${pairing.credentialId ?? "none"} to ${session.id}/${session.credential_id}.`
    );
    return {
      sessionId: session.id,
      controllerToken: session.controller_token,
      edgeId: session.edge_id,
      edgeHost: session.edge_host,
      pairUrl: session.pair_url,
      qrPayload: session.qr_payload,
      credentialId: session.credential_id,
      status: session.status,
      expiresAt: session.expires_at
    };
  } catch (error) {
    api.logger.warn?.(`ZhiHand claimed-pairing recovery skipped: ${errorMessage(error)}`);
    return pairing;
  }
}

function resolvePluginConfig(api: OpenClawPluginApi): PluginConfig {
  return ((api.pluginConfig ?? {}) as PluginConfig);
}

function resolveControlPlaneEndpoint(api: OpenClawPluginApi): string {
  return resolvePluginConfig(api).controlPlaneEndpoint?.trim() || DEFAULT_CONTROL_PLANE_ENDPOINT;
}

function validatePromptRelayConfig(api: OpenClawPluginApi): void {
  resolveControlPlaneEndpoint(api);
  resolveGatewayResponsesEndpoint(api);
  resolveGatewayAuthToken(api);
  resolveMobileAgentId(api);
}

function requiresUiSettleDelay(commandType: unknown): boolean {
  if (typeof commandType !== "string") {
    return false;
  }
  return commandType !== "receive_clipboard";
}

function resolveGatewayResponsesEndpoint(api: OpenClawPluginApi): string {
  return (
    resolvePluginConfig(api).gatewayResponsesEndpoint?.trim() ??
    DEFAULT_GATEWAY_RESPONSES_ENDPOINT
  );
}

export function resolveGatewayAuthToken(api: OpenClawPluginApi): string {
  const configured = resolvePluginConfig(api).gatewayAuthToken?.trim();
  if (!configured) {
    throw new Error(
      "ZhiHand OpenClaw plugin requires plugins.entries.openclaw.config.gatewayAuthToken for native /v1/responses relay."
    );
  }
  return configured;
}

function resolveMobileAgentId(api: OpenClawPluginApi): string {
  const agentId = resolvePluginConfig(api).mobileAgentId?.trim();
  return agentId || DEFAULT_MOBILE_AGENT_ID;
}

function buildMobileAgentUser(pairing: StoredPairingState): string {
  const credential = pairing.credentialId?.trim();
  if (!credential) {
    throw new Error("ZhiHand pairing is claimed but missing a credential id.");
  }
  return `zhihand-mobile:${credential}`;
}

function normalizedPairingTTL(raw?: number): number {
  if (!Number.isFinite(raw) || raw == null || raw <= 0) {
    return 600;
  }
  return Math.max(30, Math.min(3600, Math.trunc(raw)));
}

function formatStatusText(status: Record<string, unknown>): string {
  const deviceProfile = (status.deviceProfile as Record<string, unknown> | undefined) ?? null;
  const pluginUpdate = (status.pluginUpdate as
    | {
        latestVersion?: string | null;
        lastCheckedAt?: string | null;
        error?: string | null;
      }
    | undefined) ?? null;
  return [
    `Plugin Version: ${stringValue(status.pluginVersion) ?? "n/a"}`,
    stringValue(status.pluginUpdateSummary) ?? "Plugin Update: not checked yet",
    pluginUpdate?.latestVersion
      ? `Latest Plugin Version: ${pluginUpdate.latestVersion}`
      : `Latest Plugin Version: unknown`,
    pluginUpdate?.lastCheckedAt
      ? `Last Plugin Check: ${pluginUpdate.lastCheckedAt}`
      : `Last Plugin Check: never`,
    pluginUpdate?.error
      ? `Plugin Update Error: ${pluginUpdate.error}`
      : null,
    `Edge Host: ${stringValue(status.edgeHost) ?? "n/a"}`,
    `Pairing: ${stringValue(status.pairingStatus) ?? "n/a"}`,
    `Credential: ${stringValue(status.credentialId) ?? "not paired"}`,
    deviceProfile
      ? `Device: ${[
          stringValue(deviceProfile.brand),
          stringValue(deviceProfile.model),
          stringValue(deviceProfile.romFamily),
          stringValue(deviceProfile.systemRelease)
        ].filter(Boolean).join(" / ")}`
      : `Device Profile: ${stringValue(status.deviceProfileError) ?? "not available"}`,
    status.latestScreenAgeMs != null
      ? `Latest Screen Age: ${status.latestScreenAgeMs} ms`
      : `Latest Screen: ${stringValue(status.latestScreenError) ?? "not available"}`
  ].filter((line): line is string => Boolean(line)).join("\n");
}

function formatSnapshotSummary(snapshot: { snapshot: ScreenSnapshotRecord; ageMs: number | null; capturedAt: string | null }): string {
  return [
    "Latest ZhiHand screen snapshot fetched.",
    `Age: ${snapshot.ageMs ?? "unknown"} ms`,
    `Captured At: ${snapshot.capturedAt ?? snapshot.snapshot.captured_at}`,
    `Size: ${snapshot.snapshot.width}x${snapshot.snapshot.height}`,
    `Sequence: ${snapshot.snapshot.sequence}`,
    "Use normalized coordinates in zhihand_control: top-left is (0,0), bottom-right is (1,1)."
  ].join("\n");
}

function assertFreshScreenSnapshot(snapshot: {
  snapshot: ScreenSnapshotRecord;
  ageMs: number | null;
  capturedAt: string | null;
}): void {
  if (snapshot.ageMs != null && snapshot.ageMs > MAX_FRESH_SCREEN_AGE_MS) {
    const ageSeconds = (snapshot.ageMs / 1000).toFixed(1);
    throw new Error(
      `ZhiHand screen snapshot is stale (${ageSeconds}s old). Ask the user to restore screen sharing before visual actions.`
    );
  }
}

function formatAckSummary(
  queued: QueuedCommandRecord,
  command: QueuedCommandRecord,
  acked: boolean
): string {
  if (!acked) {
    return `Queued ${queued.command.type} as ${queued.id}, still waiting for ACK.`;
  }
  return [
    `Queued ${queued.command.type} as ${queued.id}.`,
    `ACK status: ${command.ack_status ?? "ok"}`,
    command.ack_result ? `ACK result: ${JSON.stringify(command.ack_result)}` : "ACK result: none"
  ].join("\n");
}

function readControlParams(params: Record<string, unknown>) {
  const action = readRequiredString(params, "action");
  switch (action) {
    case "click":
      return {
        action,
        xRatio: readRequiredRatio(params, "xRatio"),
        yRatio: readRequiredRatio(params, "yRatio")
      } as const;
    case "long_click":
      return {
        action,
        xRatio: readRequiredRatio(params, "xRatio"),
        yRatio: readRequiredRatio(params, "yRatio"),
        durationMs: readOptionalNumber(params, "durationMs")
      } as const;
    case "move":
      return {
        action,
        dxRatio: readRequiredSignedRatio(params, "dxRatio"),
        dyRatio: readRequiredSignedRatio(params, "dyRatio")
      } as const;
    case "move_to":
      return {
        action,
        xRatio: readRequiredRatio(params, "xRatio"),
        yRatio: readRequiredRatio(params, "yRatio")
      } as const;
    case "swipe":
      return {
        action,
        x1Ratio: readRequiredRatio(params, "x1Ratio"),
        y1Ratio: readRequiredRatio(params, "y1Ratio"),
        x2Ratio: readRequiredRatio(params, "x2Ratio"),
        y2Ratio: readRequiredRatio(params, "y2Ratio"),
        durationMs: readOptionalNumber(params, "durationMs")
      } as const;
    case "back":
    case "home":
    case "enter":
    case "start_live_capture":
    case "stop_live_capture":
      return { action } as const;
    case "input_text":
      return {
        action,
        text: readRequiredString(params, "text"),
        mode: readOptionalEnum(params, "mode", ["auto", "paste", "type"]),
        submit: readOptionalBoolean(params, "submit")
      } as const;
    case "open_app":
      return { action, packageName: readRequiredString(params, "packageName") } as const;
    case "set_clipboard":
      return { action, text: readRequiredString(params, "text") } as const;
    default:
      throw new Error(`Unsupported ZhiHand action: ${action}`);
  }
}

function readRequiredString(params: Record<string, unknown>, key: string): string {
  const value = params[key];
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`Missing required string parameter: ${key}`);
  }
  return value.trim();
}

function readOptionalBoolean(params: Record<string, unknown>, key: string): boolean | undefined {
  const value = params[key];
  if (value == null) {
    return undefined;
  }
  if (typeof value !== "boolean") {
    throw new Error(`Optional boolean parameter ${key} must be a boolean when provided.`);
  }
  return value;
}

function readOptionalEnum<T extends readonly string[]>(
  params: Record<string, unknown>,
  key: string,
  allowed: T
): T[number] | undefined {
  const value = params[key];
  if (value == null) {
    return undefined;
  }
  if (typeof value !== "string" || !allowed.includes(value as T[number])) {
    throw new Error(`Optional parameter ${key} must be one of: ${allowed.join(", ")}`);
  }
  return value as T[number];
}

function readRequiredNumber(params: Record<string, unknown>, key: string): number {
  const value = params[key];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`Missing required number parameter: ${key}`);
  }
  return value;
}

function readRequiredRatio(params: Record<string, unknown>, key: string): number {
  const value = readRequiredNumber(params, key);
  if (value < 0 || value > 1) {
    throw new Error(`Parameter ${key} must be a normalized ratio in [0, 1].`);
  }
  return value;
}

function readRequiredSignedRatio(params: Record<string, unknown>, key: string): number {
  const value = readRequiredNumber(params, key);
  if (value < -1 || value > 1) {
    throw new Error(`Parameter ${key} must be a normalized ratio in [-1, 1].`);
  }
  return value;
}

function readOptionalNumber(params: Record<string, unknown>, key: string): number | undefined {
  const value = params[key];
  if (value == null) {
    return undefined;
  }
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`Invalid number parameter: ${key}`);
  }
  return value;
}

function stringValue(input: unknown): string | null {
  return typeof input === "string" && input.trim() !== "" ? input : null;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

function withDeviceProfileContext(
  prepared: { promptInput: any[]; effectivePromptText: string },
  profile: DeviceProfileRecord | null
): { promptInput: any[]; effectivePromptText: string } {
  const context = buildDeviceProfileContext(profile);
  if (!context) {
    return prepared;
  }

  const promptInput = prepared.promptInput.map((item, index) => {
    if (index !== 0 || item.type !== "message" || item.role !== "user" || !Array.isArray(item.content)) {
      return item;
    }
    const content = [...item.content];
    const first = content[0];
    if (first?.type === "input_text" && typeof first.text === "string") {
      content[0] = {
        ...first,
        text: `${context}\n\nUser request:\n${first.text}`.trim()
      };
    } else {
      content.unshift({
        type: "input_text",
        text: context
      });
    }
    return { ...item, content };
  });

  return {
    promptInput,
    effectivePromptText: `${context}\n\n${prepared.effectivePromptText}`.trim()
  };
}

function buildDeviceProfileContext(profile: DeviceProfileRecord | null): string {
  if (!profile) {
    return "";
  }
  const attributes = profile.attributes ?? {};
  const lines = [
    "Current mobile device profile:",
    `- Platform: ${profile.platform}`,
    stringValue(profile.profile_key) ? `- Profile Key: ${profile.profile_key}` : "",
    `- Device: ${[
      stringValue(attributes.brand),
      stringValue(attributes.model),
      stringValue(attributes.rom_family),
      stringValue(attributes.system_release)
    ].filter(Boolean).join(" / ")}`,
    `- Locale: ${stringValue(attributes.locale) ?? "n/a"} | Navigation: ${stringValue(attributes.navigation_mode) ?? "unknown"}`,
    `- Full Access Strategy: ${stringValue(attributes.full_access_strategy_key) ?? "unknown"}`,
    `- HID: connected=${booleanFlag(attributes.hid_connected)} bonded=${booleanFlag(attributes.hid_bonded)} pairing=${booleanFlag(attributes.hid_pairing)}`,
    `- Screen Capture: recording=${booleanFlag(attributes.recording_active)} full_access_enabled=${booleanFlag(attributes.full_access_enabled)}`
  ].filter(Boolean);
  return lines.join("\n");
}

function booleanFlag(value: unknown): string {
  return value === true ? "yes" : "no";
}

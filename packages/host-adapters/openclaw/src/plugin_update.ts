import type { OpenClawPluginApi } from "./openclaw_api.ts";
import {
  resolveEffectivePluginConfig,
  tryLoadOpenClawConfig
} from "./openclaw_config.ts";
import {
  OPENCLAW_PACKAGE_NAME,
  OPENCLAW_PACKAGE_VERSION,
  OPENCLAW_USER_AGENT
} from "./package_metadata.ts";
import {
  LEGACY_ZHIHAND_PLUGIN_ID,
  ZHIHAND_CLAWHUB_PACKAGE_NAME,
  ZHIHAND_PLUGIN_ID,
  formatPluginConfigSettingPath
} from "./plugin_identity.ts";
import { loadState, saveState, type StoredPluginState } from "./state_store.ts";

const DEFAULT_UPDATE_CHECK_INTERVAL_HOURS = 24;
const DEFAULT_NPM_REGISTRY_ORIGIN = "https://registry.npmjs.org";
const UPDATE_CHECK_TIMEOUT_MS = 10_000;
const HOST_UPDATE_COMMAND = `openclaw plugins update ${ZHIHAND_PLUGIN_ID}`;

export type PluginUpdateState =
  | "available"
  | "current"
  | "disabled"
  | "restart-required"
  | "unknown";

export type PluginUpdateStatus = {
  state: PluginUpdateState;
  currentVersion: string;
  latestVersion: string | null;
  pendingRestartVersion: string | null;
  lastCheckedAt: string | null;
  error: string | null;
  checkedFrom: "cache" | "live" | "none";
};

type PluginUpdateCheckOptions = {
  force?: boolean;
  logAvailable?: boolean;
  allowDisabled?: boolean;
};

type NpmRegistryPackageRecord = {
  "dist-tags"?: {
    latest?: unknown;
  };
  version?: unknown;
  error?: unknown;
  reason?: unknown;
};

export function comparePluginVersions(left: string, right: string): number {
  const leftParts = parseVersion(left);
  const rightParts = parseVersion(right);
  if (!leftParts || !rightParts) {
    return left.localeCompare(right, undefined, { numeric: true });
  }
  for (let index = 0; index < 3; index += 1) {
    const delta = leftParts[index]! - rightParts[index]!;
    if (delta !== 0) {
      return delta;
    }
  }
  return 0;
}

export function buildHostUpdateCommand(): string {
  return HOST_UPDATE_COMMAND;
}

export function buildPinnedInstallCommand(version: string): string {
  return `openclaw plugins install clawhub:${ZHIHAND_CLAWHUB_PACKAGE_NAME}@${version}`;
}

export function buildPinnedNpmInstallCommand(version: string): string {
  return `openclaw plugins install ${OPENCLAW_PACKAGE_NAME}@${version}`;
}

export function formatAvailablePluginUpdateInstruction(version: string): string {
  return [
    `ZhiHand plugin ${version} is available.`,
    `Run this on the host shell: ${buildHostUpdateCommand()}`,
    `Use this pinned ClawHub install command only for a first install or after removing the existing extension directory: ${buildPinnedInstallCommand(version)}`,
    `Compatibility npm fallback: ${buildPinnedNpmInstallCommand(version)}`,
    "Then restart the OpenClaw gateway to load plugins."
  ].join("\n");
}

export function extractLatestVersionFromRegistryPayload(
  payload: NpmRegistryPackageRecord
): string {
  const latestVersion = normalizeNullableString(payload["dist-tags"]?.latest)
    ?? normalizeNullableString(payload.version);
  if (!latestVersion) {
    throw new Error("npm registry did not return a latest package version.");
  }
  return latestVersion;
}

export function buildPluginUpdateStatus(input: {
  currentVersion?: string;
  latestVersion?: string | null;
  pendingRestartVersion?: string | null;
  lastCheckedAt?: string | null;
  error?: string | null;
  checkedFrom?: "cache" | "live" | "none";
  updateCheckEnabled?: boolean;
}): PluginUpdateStatus {
  const currentVersion = input.currentVersion ?? OPENCLAW_PACKAGE_VERSION;
  const latestVersion = normalizeNullableString(input.latestVersion);
  const pendingRestartVersion = normalizeNullableString(input.pendingRestartVersion);
  const lastCheckedAt = normalizeNullableString(input.lastCheckedAt);
  const error = normalizeNullableString(input.error);
  const checkedFrom = input.checkedFrom ?? "none";
  const updateCheckEnabled = input.updateCheckEnabled ?? true;

  if (
    pendingRestartVersion &&
    comparePluginVersions(pendingRestartVersion, currentVersion) > 0
  ) {
    return {
      state: "restart-required",
      currentVersion,
      latestVersion,
      pendingRestartVersion,
      lastCheckedAt,
      error,
      checkedFrom
    };
  }

  if (latestVersion && comparePluginVersions(latestVersion, currentVersion) > 0) {
    return {
      state: "available",
      currentVersion,
      latestVersion,
      pendingRestartVersion,
      lastCheckedAt,
      error,
      checkedFrom
    };
  }

  if (!updateCheckEnabled && !latestVersion && !lastCheckedAt) {
    return {
      state: "disabled",
      currentVersion,
      latestVersion,
      pendingRestartVersion,
      lastCheckedAt,
      error,
      checkedFrom
    };
  }

  if (latestVersion || lastCheckedAt) {
    return {
      state: "current",
      currentVersion,
      latestVersion,
      pendingRestartVersion,
      lastCheckedAt,
      error,
      checkedFrom
    };
  }

  return {
    state: updateCheckEnabled ? "unknown" : "disabled",
    currentVersion,
    latestVersion,
    pendingRestartVersion,
    lastCheckedAt,
    error,
    checkedFrom
  };
}

export function normalizeStoredUpdateState(input: {
  currentVersion?: string;
  update?: StoredPluginState["update"];
}): {
  update?: StoredPluginState["update"];
  changed: boolean;
} {
  const currentVersion = input.currentVersion ?? OPENCLAW_PACKAGE_VERSION;
  const update = input.update ? { ...input.update } : undefined;
  let changed = false;

  if (
    update?.pendingRestartVersion &&
    comparePluginVersions(currentVersion, update.pendingRestartVersion) >= 0
  ) {
    delete update.pendingRestartVersion;
    changed = true;
  }

  if (
    update &&
    !update.latestVersion &&
    !update.lastCheckedAt &&
    !update.lastError &&
    !update.pendingRestartVersion &&
    !update.lastInstalledAt
  ) {
    return {
      update: undefined,
      changed: true
    };
  }

  return { update, changed };
}

export function formatPluginUpdateSummary(status: PluginUpdateStatus): string {
  switch (status.state) {
    case "available":
      return `Plugin Update: available (${status.currentVersion} -> ${status.latestVersion})`;
    case "current":
      return `Plugin Update: current (${status.currentVersion})`;
    case "disabled":
      return "Plugin Update: auto-check disabled";
    case "restart-required":
      return `Plugin Update: restart required for ${status.pendingRestartVersion}`;
    default:
      return `Plugin Update: ${status.error ?? "not checked yet"}`;
  }
}

export function formatPluginUpdateDetails(status: PluginUpdateStatus): string {
  const lines = [
    `Plugin Version: ${status.currentVersion}`,
    formatPluginUpdateSummary(status),
    `Latest Plugin Version: ${status.latestVersion ?? "unknown"}`,
    `Last Plugin Check: ${status.lastCheckedAt ?? "never"}`
  ];

  if (status.state === "available") {
    lines.push("Run /zhihand update to print the safe host-side update command.");
  } else if (status.state === "restart-required") {
    lines.push("Restart the OpenClaw gateway to load the already-installed plugin version.");
  } else if (status.state === "disabled") {
    lines.push(
      `Automatic checks are disabled by ${formatPluginConfigSettingPath("updateCheckEnabled")}. Legacy ${formatPluginConfigSettingPath("updateCheckEnabled", LEGACY_ZHIHAND_PLUGIN_ID)} is still accepted during migration.`
    );
  }

  if (status.error && status.state !== "unknown") {
    lines.push(`Plugin Update Error: ${status.error}`);
  }

  return lines.join("\n");
}

export async function resolvePluginUpdateStatus(
  api: OpenClawPluginApi,
  options: PluginUpdateCheckOptions = {}
): Promise<PluginUpdateStatus> {
  const { stateDir, state } = await loadNormalizedPluginState(api);
  const updateCheckEnabled = isUpdateCheckEnabled(api);

  if (!options.allowDisabled && !updateCheckEnabled) {
    return buildPluginUpdateStatus({
      latestVersion: state.update?.latestVersion,
      pendingRestartVersion: state.update?.pendingRestartVersion,
      lastCheckedAt: state.update?.lastCheckedAt,
      error: state.update?.lastError,
      checkedFrom: state.update?.lastCheckedAt ? "cache" : "none",
      updateCheckEnabled: false
    });
  }

  if (!options.force && !shouldRunRemoteCheck(api, state)) {
    return buildPluginUpdateStatus({
      latestVersion: state.update?.latestVersion,
      pendingRestartVersion: state.update?.pendingRestartVersion,
      lastCheckedAt: state.update?.lastCheckedAt,
      error: state.update?.lastError,
      checkedFrom: state.update?.lastCheckedAt ? "cache" : "none",
      updateCheckEnabled
    });
  }

  const now = new Date().toISOString();
  try {
    const latestVersion = await fetchLatestPackageVersion();
    state.update = {
      ...state.update,
      latestVersion,
      lastCheckedAt: now,
      lastError: undefined
    };
    await saveState(stateDir, state);
    const status = buildPluginUpdateStatus({
      latestVersion,
      pendingRestartVersion: state.update.pendingRestartVersion,
      lastCheckedAt: state.update.lastCheckedAt,
      error: state.update.lastError,
      checkedFrom: "live",
      updateCheckEnabled
    });
    if (options.logAvailable && status.state === "available") {
      api.logger.info?.(
        `ZhiHand plugin update available: ${status.currentVersion} -> ${status.latestVersion}. Run ${buildHostUpdateCommand()} on the host, then restart the gateway.`
      );
    }
    return status;
  } catch (error) {
    state.update = {
      ...state.update,
      lastCheckedAt: now,
      lastError: errorMessage(error)
    };
    await saveState(stateDir, state);
    return buildPluginUpdateStatus({
      latestVersion: state.update.latestVersion,
      pendingRestartVersion: state.update.pendingRestartVersion,
      lastCheckedAt: state.update.lastCheckedAt,
      error: state.update.lastError,
      checkedFrom: state.update.latestVersion ? "cache" : "none",
      updateCheckEnabled
    });
  }
}

export async function prepareLatestPluginUpdateInstruction(
  api: OpenClawPluginApi
): Promise<{ text: string; status: PluginUpdateStatus }> {
  const status = await resolvePluginUpdateStatus(api, {
    force: true,
    allowDisabled: true
  });

  if (status.state === "restart-required") {
    return {
      status,
      text: [
        `ZhiHand plugin ${status.pendingRestartVersion} is already installed on disk.`,
        "Restart the OpenClaw gateway to load it."
      ].join("\n")
    };
  }

  if (!status.latestVersion || comparePluginVersions(status.latestVersion, status.currentVersion) <= 0) {
    return {
      status,
      text: [
        `ZhiHand plugin is already up to date (${status.currentVersion}).`,
        `Last check: ${status.lastCheckedAt ?? "never"}.`
      ].join("\n")
    };
  }

  return {
    status,
    text: formatAvailablePluginUpdateInstruction(status.latestVersion)
  };
}

async function loadNormalizedPluginState(
  api: OpenClawPluginApi
): Promise<{ stateDir: string; state: StoredPluginState }> {
  const stateDir = api.runtime.state.resolveStateDir();
  const state = await loadState(stateDir);
  const normalized = normalizeStoredUpdateState({ update: state.update });
  state.update = normalized.update;

  if (normalized.changed) {
    await saveState(stateDir, state);
  }

  return { stateDir, state };
}

function shouldRunRemoteCheck(api: OpenClawPluginApi, state: StoredPluginState): boolean {
  const lastCheckedAt = state.update?.lastCheckedAt;
  if (!lastCheckedAt) {
    return true;
  }
  const lastCheckedTime = Date.parse(lastCheckedAt);
  if (Number.isNaN(lastCheckedTime)) {
    return true;
  }
  return (Date.now() - lastCheckedTime) >= resolveUpdateCheckIntervalMs(api);
}

function isUpdateCheckEnabled(api: OpenClawPluginApi): boolean {
  const configured = resolveRuntimePluginConfig(api).updateCheckEnabled;
  return configured !== false;
}

function resolveUpdateCheckIntervalMs(api: OpenClawPluginApi): number {
  const raw = resolveRuntimePluginConfig(api).updateCheckIntervalHours;
  if (!Number.isFinite(raw) || raw == null) {
    return DEFAULT_UPDATE_CHECK_INTERVAL_HOURS * 3_600_000;
  }
  const hours = Math.min(168, Math.max(1, Math.trunc(raw)));
  return hours * 3_600_000;
}

function resolveRuntimePluginConfig(api: OpenClawPluginApi): Record<string, unknown> {
  return resolveEffectivePluginConfig(
    api.pluginConfig,
    tryLoadOpenClawConfig(),
    [ZHIHAND_PLUGIN_ID, LEGACY_ZHIHAND_PLUGIN_ID]
  );
}

async function fetchLatestPackageVersion(): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), UPDATE_CHECK_TIMEOUT_MS);

  try {
    const response = await fetch(
      `${resolveRegistryOrigin()}/${encodeURIComponent(OPENCLAW_PACKAGE_NAME)}`,
      {
        headers: {
          accept: "application/json",
          "user-agent": OPENCLAW_USER_AGENT
        },
        signal: controller.signal
      }
    );

    const payload = parseRegistryPayload(await response.text());
    if (!response.ok) {
      throw new Error(extractRegistryError(payload, response.status));
    }

    return extractLatestVersionFromRegistryPayload(payload);
  } catch (error) {
    if (isAbortError(error)) {
      throw new Error("npm registry request timed out.");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function resolveRegistryOrigin(): string {
  return stripTrailingSlash(DEFAULT_NPM_REGISTRY_ORIGIN);
}

function parseRegistryPayload(rawBody: string): NpmRegistryPackageRecord {
  try {
    return JSON.parse(rawBody) as NpmRegistryPackageRecord;
  } catch {
    throw new Error("npm registry returned invalid JSON.");
  }
}

function extractRegistryError(payload: NpmRegistryPackageRecord, status: number): string {
  const reason = normalizeNullableString(payload.reason) ?? normalizeNullableString(payload.error);
  if (reason) {
    return `npm registry request failed with status ${status}: ${reason}`;
  }
  return `npm registry request failed with status ${status}.`;
}

function parseVersion(version: string): [number, number, number] | null {
  const match = version.trim().match(/^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/);
  if (!match) {
    return null;
  }
  return [
    Number.parseInt(match[1]!, 10),
    Number.parseInt(match[2]!, 10),
    Number.parseInt(match[3]!, 10)
  ];
}

function normalizeNullableString(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

function stripTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

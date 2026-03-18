import { spawn } from "node:child_process";
import { once } from "node:events";
import fs from "node:fs/promises";
import path from "node:path";

import type { OpenClawPluginApi } from "./openclaw_api.ts";
import {
  OPENCLAW_PACKAGE_NAME,
  OPENCLAW_PACKAGE_ROOT_DIR,
  OPENCLAW_PACKAGE_VERSION
} from "./package_metadata.ts";
import { loadState, saveState, type StoredPluginState } from "./state_store.ts";

const DEFAULT_UPDATE_CHECK_INTERVAL_HOURS = 24;
const UPDATE_CHECK_TIMEOUT_MS = 20_000;
const UPDATE_INSTALL_TIMEOUT_MS = 5 * 60_000;

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

type UpgradePlan = {
  command: string;
  args: string[];
  cwd?: string;
  label: string;
  manualCommand: string;
};

type PackageLike = {
  dependencies?: Record<string, unknown>;
  devDependencies?: Record<string, unknown>;
  optionalDependencies?: Record<string, unknown>;
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
      return `Plugin Update: installed on disk (${status.pendingRestartVersion}), reload OpenClaw`;
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
    lines.push("Run /zhihand update to install the latest published version.");
  } else if (status.state === "restart-required") {
    lines.push("Reload or restart OpenClaw to start using the installed version.");
  } else if (status.state === "disabled") {
    lines.push(
      "Automatic checks are disabled by plugins.entries.openclaw.config.updateCheckEnabled."
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
        `ZhiHand plugin update available: ${status.currentVersion} -> ${status.latestVersion}. Run /zhihand update to install it, then reload OpenClaw.`
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

export async function installLatestPluginUpdate(
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
        "Reload or restart OpenClaw to start using the new version."
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

  const plan = await resolveUpgradePlan(status.latestVersion);
  if (!plan) {
    return {
      status,
      text: [
        `ZhiHand plugin ${status.latestVersion} is available, but this install is not safe to upgrade in place automatically.`,
        `Manual fallback: ${buildOpenClawInstallCommand(status.latestVersion)}`
      ].join("\n")
    };
  }

  try {
    await runCommand(plan.command, plan.args, {
      cwd: plan.cwd,
      timeoutMs: UPDATE_INSTALL_TIMEOUT_MS
    });
  } catch (error) {
    return {
      status,
      text: [
        `ZhiHand plugin update failed via ${plan.label}: ${errorMessage(error)}`,
        `Manual fallback: ${plan.manualCommand}`
      ].join("\n")
    };
  }

  const now = new Date().toISOString();
  const { stateDir, state } = await loadNormalizedPluginState(api);
  state.update = {
    ...state.update,
    latestVersion: status.latestVersion,
    lastCheckedAt: now,
    lastInstalledAt: now,
    pendingRestartVersion: status.latestVersion,
    lastError: undefined
  };
  await saveState(stateDir, state);

  return {
    status: buildPluginUpdateStatus({
      latestVersion: status.latestVersion,
      pendingRestartVersion: status.latestVersion,
      lastCheckedAt: now,
      checkedFrom: "live",
      updateCheckEnabled: true
    }),
    text: [
      `ZhiHand plugin ${status.latestVersion} was installed on disk.`,
      "Reload or restart OpenClaw to start using the new version."
    ].join("\n")
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
  const configured = api.pluginConfig?.updateCheckEnabled;
  return configured !== false;
}

function resolveUpdateCheckIntervalMs(api: OpenClawPluginApi): number {
  const raw = api.pluginConfig?.updateCheckIntervalHours;
  if (!Number.isFinite(raw) || raw == null) {
    return DEFAULT_UPDATE_CHECK_INTERVAL_HOURS * 3_600_000;
  }
  const hours = Math.min(168, Math.max(1, Math.trunc(raw)));
  return hours * 3_600_000;
}

async function fetchLatestPackageVersion(): Promise<string> {
  const result = await runCommand(resolveShellCommand("npm"), [
    "view",
    OPENCLAW_PACKAGE_NAME,
    "version",
    "dist-tags.latest",
    "--json"
  ], { timeoutMs: UPDATE_CHECK_TIMEOUT_MS });
  return extractLatestVersion(result.stdout);
}

function extractLatestVersion(stdout: string): string {
  const parsed = JSON.parse(stdout) as
    | { version?: unknown; "dist-tags.latest"?: unknown }
    | string;

  if (typeof parsed === "string" && parsed.trim() !== "") {
    return parsed.trim();
  }

  if (typeof parsed === "object" && parsed !== null) {
    const latest = normalizeNullableString(parsed["dist-tags.latest"]);
    if (latest) {
      return latest;
    }
    const version = normalizeNullableString(parsed.version);
    if (version) {
      return version;
    }
  }

  throw new Error("npm view did not return a latest package version.");
}

async function resolveUpgradePlan(targetVersion: string): Promise<UpgradePlan | null> {
  if (await isLocalSourceCheckout()) {
    return null;
  }

  const globalPlan = await resolveGlobalNpmUpgradePlan(targetVersion);
  if (globalPlan) {
    return globalPlan;
  }

  const projectPlan = await resolveProjectNpmUpgradePlan(targetVersion);
  if (projectPlan) {
    return projectPlan;
  }

  return {
    command: resolveShellCommand("openclaw"),
    args: ["plugins", "install", `${OPENCLAW_PACKAGE_NAME}@${targetVersion}`],
    label: "OpenClaw plugin install",
    manualCommand: buildOpenClawInstallCommand(targetVersion)
  };
}

async function resolveGlobalNpmUpgradePlan(targetVersion: string): Promise<UpgradePlan | null> {
  try {
    const result = await runCommand(resolveShellCommand("npm"), ["root", "--global"], {
      timeoutMs: UPDATE_CHECK_TIMEOUT_MS
    });
    const globalRoot = result.stdout.trim();
    if (globalRoot === "") {
      return null;
    }
    const packagePath = path.join(globalRoot, ...OPENCLAW_PACKAGE_NAME.split("/"));
    if (path.resolve(packagePath) !== path.resolve(OPENCLAW_PACKAGE_ROOT_DIR)) {
      return null;
    }
    return {
      command: resolveShellCommand("npm"),
      args: ["install", "--global", `${OPENCLAW_PACKAGE_NAME}@${targetVersion}`],
      cwd: OPENCLAW_PACKAGE_ROOT_DIR,
      label: "npm global install",
      manualCommand: `npm install --global ${OPENCLAW_PACKAGE_NAME}@${targetVersion}`
    };
  } catch {
    return null;
  }
}

async function resolveProjectNpmUpgradePlan(targetVersion: string): Promise<UpgradePlan | null> {
  const projectRoot = await findOwningProjectRoot(OPENCLAW_PACKAGE_ROOT_DIR);
  if (!projectRoot) {
    return null;
  }
  return {
    command: resolveShellCommand("npm"),
    args: ["install", `${OPENCLAW_PACKAGE_NAME}@${targetVersion}`],
    cwd: projectRoot,
    label: "npm project install",
    manualCommand: `cd ${shellQuote(projectRoot)} && npm install ${OPENCLAW_PACKAGE_NAME}@${targetVersion}`
  };
}

async function findOwningProjectRoot(packageRoot: string): Promise<string | null> {
  let current = path.dirname(packageRoot);
  while (true) {
    const packageJsonPath = path.join(current, "package.json");
    if (await pathExists(packageJsonPath)) {
      if (await projectUsesNpm(current)) {
        try {
          const pkg = JSON.parse(
            await fs.readFile(packageJsonPath, "utf8")
          ) as PackageLike;
          if (declaresDependency(pkg, OPENCLAW_PACKAGE_NAME)) {
            return current;
          }
        } catch {
          return null;
        }
      } else {
        return null;
      }
    }
    const parent = path.dirname(current);
    if (parent === current) {
      return null;
    }
    current = parent;
  }
}

async function projectUsesNpm(projectRoot: string): Promise<boolean> {
  if (
    await pathExists(path.join(projectRoot, "package-lock.json")) ||
    await pathExists(path.join(projectRoot, "npm-shrinkwrap.json"))
  ) {
    return true;
  }

  if (
    await pathExists(path.join(projectRoot, "pnpm-lock.yaml")) ||
    await pathExists(path.join(projectRoot, "yarn.lock")) ||
    await pathExists(path.join(projectRoot, "bun.lockb"))
  ) {
    return false;
  }

  return true;
}

function declaresDependency(pkg: PackageLike, packageName: string): boolean {
  return [
    pkg.dependencies,
    pkg.devDependencies,
    pkg.optionalDependencies
  ].some((dependencies) => Boolean(dependencies?.[packageName]));
}

async function isLocalSourceCheckout(): Promise<boolean> {
  if (OPENCLAW_PACKAGE_ROOT_DIR.includes(`${path.sep}node_modules${path.sep}`)) {
    return false;
  }
  let current = OPENCLAW_PACKAGE_ROOT_DIR;
  while (true) {
    if (await pathExists(path.join(current, ".git"))) {
      return true;
    }
    const parent = path.dirname(current);
    if (parent === current) {
      return false;
    }
    current = parent;
  }
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function runCommand(
  command: string,
  args: string[],
  options: { cwd?: string; timeoutMs: number }
): Promise<{ stdout: string; stderr: string }> {
  const child = spawn(command, args, {
    cwd: options.cwd,
    shell: process.platform === "win32",
    stdio: ["ignore", "pipe", "pipe"]
  });

  const stdoutChunks: Buffer[] = [];
  const stderrChunks: Buffer[] = [];
  child.stdout.on("data", (chunk: Buffer) => stdoutChunks.push(chunk));
  child.stderr.on("data", (chunk: Buffer) => stderrChunks.push(chunk));

  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    child.kill("SIGTERM");
  }, options.timeoutMs);

  try {
    const result = await Promise.race([
      once(child, "exit"),
      once(child, "error").then(([error]) => {
        throw error;
      })
    ]);
    const [exitCode, signal] = result as [number | null, NodeJS.Signals | null];
    const stdout = Buffer.concat(stdoutChunks).toString("utf8").trim();
    const stderr = Buffer.concat(stderrChunks).toString("utf8").trim();
    if (timedOut) {
      throw new Error(`Command ${command} ${args.join(" ")} timed out.`);
    }
    if (signal) {
      throw new Error(`Command ${command} ${args.join(" ")} was terminated by ${signal}.`);
    }
    if (exitCode !== 0) {
      throw new Error(stderr || stdout || `Command ${command} exited with code ${exitCode}.`);
    }
    return { stdout, stderr };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error(`Command not found: ${command}`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function buildOpenClawInstallCommand(targetVersion: string): string {
  return `openclaw plugins install ${OPENCLAW_PACKAGE_NAME}@${targetVersion}`;
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

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function resolveShellCommand(command: "npm" | "openclaw"): string {
  return command;
}

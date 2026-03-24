import fs from "node:fs";
import os from "node:os";
import path from "node:path";

type OpenClawToolPolicyConfig = {
  allow?: unknown;
};

type OpenClawPluginEntryConfig = {
  enabled?: unknown;
  config?: unknown;
};

type OpenClawAgentConfig = {
  id?: unknown;
  tools?: OpenClawToolPolicyConfig;
};

export type OpenClawConfigFile = {
  tools?: OpenClawToolPolicyConfig;
  agents?: {
    list?: OpenClawAgentConfig[];
  };
  plugins?: {
    allow?: unknown;
    deny?: unknown;
    entries?: Record<string, OpenClawPluginEntryConfig>;
  };
};

export function tryLoadOpenClawConfig(): OpenClawConfigFile | null {
  const configPath = path.join(os.homedir(), ".openclaw", "openclaw.json");
  try {
    return JSON.parse(fs.readFileSync(configPath, "utf8")) as OpenClawConfigFile;
  } catch {
    return null;
  }
}

export function resolvePluginEntryConfig(
  config: OpenClawConfigFile | null,
  pluginIds: readonly string[]
): Record<string, unknown> | null {
  const entries = config?.plugins?.entries;
  if (!entries) {
    return null;
  }
  for (const pluginId of pluginIds) {
    const candidate = entries[pluginId]?.config;
    if (candidate && typeof candidate === "object" && !Array.isArray(candidate)) {
      return candidate as Record<string, unknown>;
    }
  }
  return null;
}

export function resolveEffectivePluginConfig(
  pluginConfig: Record<string, unknown> | undefined,
  config: OpenClawConfigFile | null,
  pluginIds: readonly string[]
): Record<string, unknown> {
  const persisted = resolvePluginEntryConfig(config, pluginIds) ?? {};
  return {
    ...persisted,
    ...(pluginConfig ?? {})
  };
}

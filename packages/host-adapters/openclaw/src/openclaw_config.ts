import fs from "node:fs";
import os from "node:os";
import path from "node:path";

type OpenClawToolPolicyConfig = {
  allow?: unknown;
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
};

export function tryLoadOpenClawConfig(): OpenClawConfigFile | null {
  const configPath = path.join(os.homedir(), ".openclaw", "openclaw.json");
  try {
    return JSON.parse(fs.readFileSync(configPath, "utf8")) as OpenClawConfigFile;
  } catch {
    return null;
  }
}

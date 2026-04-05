import type { ZhiHandRuntimeConfig } from "../core/config.ts";
import type { Capabilities } from "../core/device.ts";
import { executeScreenshot } from "./control.ts";

export async function handleScreenshot(
  config: ZhiHandRuntimeConfig,
  capabilities: Capabilities | null,
) {
  return await executeScreenshot(config, capabilities);
}

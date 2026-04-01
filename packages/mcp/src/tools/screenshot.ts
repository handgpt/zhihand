import type { ZhiHandConfig } from "../core/config.ts";
import { executeScreenshot } from "./control.ts";

export async function handleScreenshot(
  config: ZhiHandConfig
): Promise<{ content: Array<{ type: string; text?: string; data?: string; mimeType?: string }> }> {
  return await executeScreenshot(config);
}

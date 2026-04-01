import type { ZhiHandConfig } from "../core/config.ts";
import { executeScreenshot } from "./control.ts";

export async function handleScreenshot(config: ZhiHandConfig) {
  return await executeScreenshot(config);
}

import fs from "node:fs/promises";
import path from "node:path";

import type { ScreenSnapshotRecord } from "./index.ts";
import type { OpenClawPluginApi } from "./openclaw_api.ts";

const SCREEN_CACHE_FILE = ["plugins", "openclaw", "latest-screen.jpg"] as const;

export async function cacheScreenSnapshot(
  api: OpenClawPluginApi,
  snapshot: ScreenSnapshotRecord
): Promise<string> {
  const screenPath = path.join(api.runtime.state.resolveStateDir(), ...SCREEN_CACHE_FILE);
  await fs.mkdir(path.dirname(screenPath), { recursive: true });
  await fs.writeFile(screenPath, Buffer.from(snapshot.frame_base64, "base64"));
  return screenPath;
}

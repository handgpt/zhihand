import type { ZhiHandConfig } from "./config.ts";

export async function fetchScreenshotBinary(config: ZhiHandConfig): Promise<Buffer> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs ?? 10_000);

  try {
    const response = await fetch(
      `${config.controlPlaneEndpoint}/v1/credentials/${encodeURIComponent(config.credentialId)}/screen`,
      {
        method: "GET",
        headers: {
          "x-zhihand-controller-token": config.controllerToken,
          "Accept": "image/jpeg",
        },
        signal: controller.signal,
      }
    );

    if (!response.ok) {
      throw new Error(`Screenshot fetch failed: ${response.status}`);
    }

    return Buffer.from(await response.arrayBuffer());
  } finally {
    clearTimeout(timeout);
  }
}

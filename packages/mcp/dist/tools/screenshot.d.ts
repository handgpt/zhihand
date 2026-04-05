import type { ZhiHandRuntimeConfig } from "../core/config.ts";
import type { Capabilities } from "../core/device.ts";
export declare function handleScreenshot(config: ZhiHandRuntimeConfig, capabilities: Capabilities | null): Promise<{
    content: ({
        type: "text";
        text: string;
    } | {
        type: "image";
        data: string;
        mimeType: "image/jpeg";
    })[];
}>;

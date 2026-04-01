import type { ZhiHandConfig } from "../core/config.ts";
export declare function handleScreenshot(config: ZhiHandConfig): Promise<{
    content: ({
        type: "text";
        text: string;
    } | {
        type: "image";
        data: string;
        mimeType: "image/jpeg";
    })[];
}>;

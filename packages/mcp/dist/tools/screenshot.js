import { executeScreenshot } from "./control.js";
export async function handleScreenshot(config, capabilities) {
    return await executeScreenshot(config, capabilities);
}

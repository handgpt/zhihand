import { z } from "zod";
const deviceIdSchema = z.string().optional().describe("Credential ID of the target device. Optional if only one device is online. Call zhihand_list_devices to see online devices.");
export const controlSchema = {
    device_id: deviceIdSchema,
    action: z.enum([
        "click", "doubleclick", "longclick", "rightclick", "middleclick",
        "type", "swipe", "scroll", "keycombo",
        "back", "home", "enter",
        "clipboard", "open_app",
        "wait", "screenshot",
    ]),
    xRatio: z.number().min(0).max(1).optional().describe("Normalized horizontal position [0,1]"),
    yRatio: z.number().min(0).max(1).optional().describe("Normalized vertical position [0,1]"),
    text: z.string().optional().describe("Text for type or clipboard set"),
    direction: z.enum(["up", "down", "left", "right"]).optional().describe("Scroll direction"),
    amount: z.number().int().positive().default(3).optional().describe("Scroll steps (default 3)"),
    keys: z.string().optional().describe("Key combo string, e.g. 'ctrl+c', 'alt+tab'"),
    durationMs: z.number().int().positive().max(10000).optional().describe("Duration in ms: wait (default 1000), longclick (default 800), swipe (default 300). Max 10000"),
    startXRatio: z.number().min(0).max(1).optional().describe("Swipe start X [0,1]"),
    startYRatio: z.number().min(0).max(1).optional().describe("Swipe start Y [0,1]"),
    endXRatio: z.number().min(0).max(1).optional().describe("Swipe end X [0,1]"),
    endYRatio: z.number().min(0).max(1).optional().describe("Swipe end Y [0,1]"),
    appPackage: z.string().optional().describe("Android package name, e.g. 'com.tencent.mm'"),
    bundleId: z.string().optional().describe("iOS bundle ID, e.g. 'com.tencent.xin'"),
    urlScheme: z.string().optional().describe("URL scheme, e.g. 'weixin://'"),
};
export const systemSchema = {
    device_id: deviceIdSchema,
    action: z.enum([
        "notification", "recent", "search", "switch_input",
        "siri", "control_center",
        "open_browser", "shortcut_help",
        "volume_up", "volume_down", "mute",
        "play_pause", "stop", "next_track", "prev_track",
        "fast_forward", "rewind",
        "brightness_up", "brightness_down", "power",
    ]).describe("System or media action to perform"),
    text: z.string().optional().describe("Optional text, e.g. search query for 'search' action"),
};
export const screenshotSchema = {
    device_id: deviceIdSchema,
};
export const pairSchema = {
    forceNew: z.boolean().default(false).optional().describe("Force new pairing even if already paired"),
};
export const listDevicesSchema = {};
export const statusSchema = {
    device_id: deviceIdSchema,
};

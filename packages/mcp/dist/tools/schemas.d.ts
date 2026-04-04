import { z } from "zod";
export declare const controlSchema: {
    action: z.ZodEnum<["click", "doubleclick", "longclick", "rightclick", "middleclick", "type", "swipe", "scroll", "keycombo", "back", "home", "enter", "clipboard", "open_app", "wait", "screenshot"]>;
    xRatio: z.ZodOptional<z.ZodNumber>;
    yRatio: z.ZodOptional<z.ZodNumber>;
    text: z.ZodOptional<z.ZodString>;
    direction: z.ZodOptional<z.ZodEnum<["up", "down", "left", "right"]>>;
    amount: z.ZodOptional<z.ZodDefault<z.ZodNumber>>;
    keys: z.ZodOptional<z.ZodString>;
    durationMs: z.ZodOptional<z.ZodNumber>;
    startXRatio: z.ZodOptional<z.ZodNumber>;
    startYRatio: z.ZodOptional<z.ZodNumber>;
    endXRatio: z.ZodOptional<z.ZodNumber>;
    endYRatio: z.ZodOptional<z.ZodNumber>;
    appPackage: z.ZodOptional<z.ZodString>;
    bundleId: z.ZodOptional<z.ZodString>;
    urlScheme: z.ZodOptional<z.ZodString>;
};
export declare const screenshotSchema: {};
export declare const pairSchema: {
    forceNew: z.ZodOptional<z.ZodDefault<z.ZodBoolean>>;
};

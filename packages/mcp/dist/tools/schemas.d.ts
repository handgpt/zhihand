import { z } from "zod";
export declare const controlSchema: {
    action: z.ZodEnum<["click", "doubleclick", "rightclick", "middleclick", "type", "swipe", "scroll", "keycombo", "clipboard", "wait", "screenshot"]>;
    xRatio: z.ZodOptional<z.ZodNumber>;
    yRatio: z.ZodOptional<z.ZodNumber>;
    text: z.ZodOptional<z.ZodString>;
    direction: z.ZodOptional<z.ZodEnum<["up", "down", "left", "right"]>>;
    amount: z.ZodOptional<z.ZodDefault<z.ZodNumber>>;
    keys: z.ZodOptional<z.ZodString>;
    clipboardAction: z.ZodOptional<z.ZodEnum<["get", "set"]>>;
    durationMs: z.ZodOptional<z.ZodDefault<z.ZodNumber>>;
    startXRatio: z.ZodOptional<z.ZodNumber>;
    startYRatio: z.ZodOptional<z.ZodNumber>;
    endXRatio: z.ZodOptional<z.ZodNumber>;
    endYRatio: z.ZodOptional<z.ZodNumber>;
};
export declare const screenshotSchema: {};
export declare const pairSchema: {
    forceNew: z.ZodOptional<z.ZodDefault<z.ZodBoolean>>;
};

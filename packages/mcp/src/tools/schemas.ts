import { z } from "zod";

export const controlSchema = {
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
  clipboardAction: z.enum(["get", "set"]).optional().describe("Clipboard action"),
  durationMs: z.number().int().positive().max(10000).default(1000).optional().describe("Duration in ms for wait, longclick, or swipe (default 1000, max 10000)"),
  startXRatio: z.number().min(0).max(1).optional().describe("Swipe start X [0,1]"),
  startYRatio: z.number().min(0).max(1).optional().describe("Swipe start Y [0,1]"),
  endXRatio: z.number().min(0).max(1).optional().describe("Swipe end X [0,1]"),
  endYRatio: z.number().min(0).max(1).optional().describe("Swipe end Y [0,1]"),
  appPackage: z.string().optional().describe("Android package name, e.g. 'com.tencent.mm'"),
  bundleId: z.string().optional().describe("iOS bundle ID, e.g. 'com.tencent.xin'"),
  urlScheme: z.string().optional().describe("URL scheme, e.g. 'weixin://'"),
  appName: z.string().optional().describe("Human-readable app name (for logging)"),
};

export const screenshotSchema = {};

export const pairSchema = {
  forceNew: z.boolean().default(false).optional().describe("Force new pairing even if already paired"),
};

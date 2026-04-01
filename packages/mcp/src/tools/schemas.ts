import { z } from "zod";

export const controlSchema = {
  action: z.enum([
    "click", "doubleclick", "rightclick", "middleclick",
    "type", "swipe", "scroll", "keycombo",
    "clipboard",
    "wait", "screenshot",
  ]),
  xRatio: z.number().min(0).max(1).optional().describe("Normalized horizontal position [0,1]"),
  yRatio: z.number().min(0).max(1).optional().describe("Normalized vertical position [0,1]"),
  text: z.string().optional().describe("Text for type or clipboard set"),
  direction: z.enum(["up", "down", "left", "right"]).optional().describe("Scroll direction"),
  amount: z.number().int().positive().default(3).optional().describe("Scroll steps (default 3)"),
  keys: z.string().optional().describe("Key combo string, e.g. 'ctrl+c', 'alt+tab'"),
  clipboardAction: z.enum(["get", "set"]).optional().describe("Clipboard action"),
  durationMs: z.number().int().positive().max(10000).default(1000).optional().describe("Duration in ms for wait (default 1000, max 10000)"),
  startXRatio: z.number().min(0).max(1).optional().describe("Swipe start X [0,1]"),
  startYRatio: z.number().min(0).max(1).optional().describe("Swipe start Y [0,1]"),
  endXRatio: z.number().min(0).max(1).optional().describe("Swipe end X [0,1]"),
  endYRatio: z.number().min(0).max(1).optional().describe("Swipe end Y [0,1]"),
};

export const screenshotSchema = {};

export const pairSchema = {
  forceNew: z.boolean().default(false).optional().describe("Force new pairing even if already paired"),
};

import test from "node:test";
import assert from "node:assert/strict";

import register, { formatPairingCommandText, resolveGatewayAuthToken } from "./plugin.ts";

test("formatPairingCommandText returns clean browser-first pairing instructions", () => {
  const text = formatPairingCommandText(
    "https://zhihand.com/download",
    "https://pair.zhihand.com/pair?d=payload"
  );

  assert.match(text, /^ZhiHand pairing QR created\./);
  assert.match(text, /Download app: https:\/\/zhihand\.com\/download/);
  assert.match(text, /QR URL: https:\/\/pair\.zhihand\.com\/pair\?d=payload/);
  assert.doesNotMatch(text, /▄▄|▀▀|scan this QR code/i);
});

test("formatPairingCommandText supports tool-oriented next steps", () => {
  const text = formatPairingCommandText(
    "https://zhihand.com/download",
    "https://pair.zhihand.com/pair?d=payload",
    "call zhihand_status"
  );

  assert.match(text, /then call zhihand_status\./);
});

test("resolveGatewayAuthToken requires explicit plugin config", () => {
  assert.throws(
    () => resolveGatewayAuthToken({ pluginConfig: {} }),
    /plugins\.entries\.openclaw\.config\.gatewayAuthToken/
  );

  assert.equal(
    resolveGatewayAuthToken({
      pluginConfig: {
        gatewayAuthToken: "  local-token  "
      }
    }),
    "local-token"
  );
});

test("register exposes update help in the slash command", async () => {
  let commandHandler:
    | ((ctx: { args?: string }) => Promise<{ text: string }>)
    | undefined;

  register({
    logger: {},
    runtime: {
      state: {
        resolveStateDir: () => "/tmp"
      }
    },
    pluginConfig: {},
    registerService: () => {},
    registerCommand: (command) => {
      commandHandler = command.handler;
    },
    registerTool: () => {}
  });

  assert.ok(commandHandler);
  const response = await commandHandler!({ args: "help" });

  assert.match(response.text, /\/zhihand update/);
  assert.match(response.text, /\/zhihand update check/);
});

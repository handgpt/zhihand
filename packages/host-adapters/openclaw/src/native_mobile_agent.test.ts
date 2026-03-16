import test from "node:test";
import assert from "node:assert/strict";

import {
  buildNativeMobileAgentInstructions,
  extractOpenResponsesText,
  runNativeMobileAgent
} from "./native_mobile_agent.ts";

test("buildNativeMobileAgentInstructions anchors native OpenClaw tool usage", () => {
  const instructions = buildNativeMobileAgentInstructions();
  assert.match(instructions, /OpenClaw/i);
  assert.match(instructions, /zhihand_status/);
  assert.match(instructions, /zhihand_screen_read/);
  assert.match(instructions, /zhihand_control/);
  assert.match(instructions, /normalized coordinates/i);
  assert.match(instructions, /xRatio/);
  assert.match(instructions, /prefer zhihand_control action enter/i);
});

test("extractOpenResponsesText prefers output_text", () => {
  assert.equal(
    extractOpenResponsesText({
      output_text: "hello"
    }),
    "hello"
  );
});

test("extractOpenResponsesText falls back to message content", () => {
  assert.equal(
    extractOpenResponsesText({
      output: [
        {
          type: "message",
          content: [
            { type: "output_text", text: "first" },
            { type: "output_text", text: "second" }
          ]
        }
      ]
    }),
    "first\nsecond"
  );
});

test("runNativeMobileAgent posts to OpenResponses and parses reply", async () => {
  let capturedAuth = "";
  let capturedBody = "";
  const fakeFetch: typeof fetch = async (_input, init) => {
    capturedAuth = String((init?.headers as Record<string, string>)?.Authorization ?? "");
    capturedBody = String(init?.body ?? "");
    return new Response(
      JSON.stringify({
        id: "resp_123",
        output: [
          {
            type: "message",
            content: [{ type: "output_text", text: "remote-ok" }]
          }
        ]
      }),
      { status: 200 }
    );
  };

  const result = await runNativeMobileAgent(
    {
      endpoint: "http://127.0.0.1:18789/v1/responses",
      authToken: "secret",
      agentId: "zhihand-mobile",
      user: "zhihand:credential:abc",
      promptText: "Reply with exactly remote-ok",
      instructions: "Use tools if needed."
    },
    fakeFetch
  );

  assert.equal(result.replyText, "remote-ok");
  assert.equal(result.runId, "resp_123");
  assert.equal(capturedAuth, "Bearer secret");
  assert.match(capturedBody, /openclaw:zhihand-mobile/);
  assert.match(capturedBody, /zhihand:credential:abc/);
  assert.match(capturedBody, /"type":"message"/);
  assert.match(capturedBody, /"type":"input_text"/);
});

test("runNativeMobileAgent surfaces response errors", async () => {
  const fakeFetch: typeof fetch = async () =>
    new Response(
      JSON.stringify({
        error: { message: "tool chain unavailable" }
      }),
      { status: 500 }
    );

  await assert.rejects(
    () =>
      runNativeMobileAgent(
        {
          endpoint: "http://127.0.0.1:18789/v1/responses",
          authToken: "secret",
          agentId: "zhihand-mobile",
          user: "zhihand:credential:abc",
          promptText: "hi"
        },
        fakeFetch
      ),
    /tool chain unavailable/
  );
});

test("runNativeMobileAgent forwards abort signals to fetch", async () => {
  let capturedSignal: AbortSignal | undefined;
  const controller = new AbortController();
  const fakeFetch: typeof fetch = async (_input, init) => {
    capturedSignal = init?.signal as AbortSignal | undefined;
    return new Response(
      JSON.stringify({
        id: "resp_abort",
        output_text: "ok"
      }),
      { status: 200 }
    );
  };

  await runNativeMobileAgent(
    {
      endpoint: "http://127.0.0.1:18789/v1/responses",
      authToken: "secret",
      agentId: "zhihand-mobile",
      user: "zhihand:credential:abc",
      promptText: "hi",
      signal: controller.signal
    },
    fakeFetch
  );

  assert.equal(capturedSignal, controller.signal);
});

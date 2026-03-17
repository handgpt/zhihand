import test from "node:test";
import assert from "node:assert/strict";

import {
  buildPairingPrompt,
  createPromptReply,
  createControlCommand,
  createEventStreamURL,
  createManifest,
  createPairingSession,
  enqueueCommand,
  enqueueMobilePrompt,
  executeAction,
  fetchLatestScreenSnapshot,
  getLatestClaimedPairingSession,
  fetchServerInfo,
  getCommand,
  getPrompt,
  getPairingSession,
  listPendingPrompts,
  listCapabilities,
  registerPlugin,
  renderPairingQRCodeSVG,
  resolveControlPlaneEndpoint,
  waitForCommandAck,
  waitForClaim
} from "./index.ts";

test("createManifest returns expected metadata", () => {
  const manifest = createManifest();
  assert.equal(manifest.name, "zhihand");
  assert.ok(manifest.capabilities.includes("pairing.bootstrap"));
  assert.ok(manifest.capabilities.includes("control.queue"));
});

test("resolveControlPlaneEndpoint prefers explicit control plane endpoint", () => {
  assert.equal(
    resolveControlPlaneEndpoint({
      endpoint: "http://127.0.0.1:8787",
      controlPlaneEndpoint: "http://127.0.0.1:8686/"
    }),
    "http://127.0.0.1:8686"
  );
});

test("resolveControlPlaneEndpoint falls back to the hosted control plane", () => {
  assert.equal(
    resolveControlPlaneEndpoint({ endpoint: "http://127.0.0.1:8787" }),
    "https://api.zhihand.com"
  );
});

test("createEventStreamURL appends client id and topics", () => {
  const url = createEventStreamURL(
    { endpoint: "http://127.0.0.1:8787/" },
    { clientId: "mobile-app", topics: ["action", "heartbeat"] }
  );

  assert.equal(
    url,
    "http://127.0.0.1:8787/v1/events/stream?client_id=mobile-app&topic=action&topic=heartbeat"
  );
});

test("fetchServerInfo and listCapabilities call the expected runtime endpoints", async () => {
  const calls: string[] = [];
  const fakeFetch: typeof fetch = async (input) => {
    const url = String(input);
    calls.push(url);
    if (url.endsWith("/v1/server/info")) {
      return new Response(
        JSON.stringify({
          service_name: "zhihandd",
          version: "test",
          protocol_version: "zhihand.control.v1",
          capabilities: []
        }),
        { status: 200 }
      );
    }

    return new Response(JSON.stringify({ items: [] }), { status: 200 });
  };

  const info = await fetchServerInfo({ endpoint: "http://127.0.0.1:8787" }, fakeFetch);
  const capabilities = await listCapabilities(
    { endpoint: "http://127.0.0.1:8787" },
    fakeFetch
  );

  assert.equal(info.service_name, "zhihandd");
  assert.deepEqual(capabilities, []);
  assert.deepEqual(calls, [
    "http://127.0.0.1:8787/v1/server/info",
    "http://127.0.0.1:8787/v1/capabilities"
  ]);
});

test("executeAction sends JSON payload and propagates response", async () => {
  let method = "";
  let body = "";
  const fakeFetch: typeof fetch = async (_input, init) => {
    method = init?.method ?? "GET";
    body = String(init?.body ?? "");
    return new Response(
      JSON.stringify({
        request_id: "act_123",
        status: "ACTION_STATUS_ACCEPTED",
        result: { accepted: true }
      }),
      { status: 202 }
    );
  };

  const response = await executeAction(
    { endpoint: "http://127.0.0.1:8787" },
    {
      type: "tool.invoke",
      source: "adapter://openclaw",
      target: "runtime://mobile"
    },
    fakeFetch
  );

  assert.equal(method, "POST");
  assert.match(body, /tool\.invoke/);
  assert.equal(response.status, "ACTION_STATUS_ACCEPTED");
});

test("registerPlugin, createPairingSession, and getPairingSession use control-plane endpoints", async () => {
  const calls: Array<{ url: string; method: string; headers: Headers; body: string }> = [];
  const fakeFetch: typeof fetch = async (input, init) => {
    const request = new Request(input, init);
    const body = request.method === "GET" ? "" : await request.text();
    calls.push({
      url: request.url,
      method: request.method,
      headers: request.headers,
      body
    });

    if (request.url.endsWith("/v1/plugins")) {
      return jsonResponse({
        plugin: {
          edge_id: "edge_123",
          edge_host: "edge-123.edge.zhihand.com",
          adapter_kind: "openclaw",
          origin_listener: "http://127.0.0.1:8787",
          created_at: "2026-03-12T00:00:00Z",
          updated_at: "2026-03-12T00:00:00Z"
        }
      }, 201);
    }

    if (request.url.endsWith("/v1/pairing/sessions")) {
      return jsonResponse({
        session: {
          id: "prs_123",
          edge_id: "edge_123",
          edge_host: "edge-123.edge.zhihand.com",
          pair_url: "https://pair.zhihand.com/pair?d=payload",
          qr_payload: "payload",
          controller_token: "ctl_123",
          status: "pending",
          created_at: "2026-03-12T00:00:00Z",
          expires_at: "2026-03-12T00:05:00Z"
        }
      }, 201);
    }

    return jsonResponse({
      session: {
        id: "prs_123",
        edge_id: "edge_123",
        edge_host: "edge-123.edge.zhihand.com",
        pair_url: "https://pair.zhihand.com/pair?d=payload",
        qr_payload: "payload",
        controller_token: "ctl_123",
        status: "claimed",
        credential_id: "crd_123",
        created_at: "2026-03-12T00:00:00Z",
        expires_at: "2026-03-12T00:05:00Z"
      }
    }, 200);
  };

  const config = {
    controlPlaneEndpoint: "http://127.0.0.1:8686",
    timeoutMs: 1_000
  };

  const plugin = await registerPlugin(config, {
    adapterKind: "openclaw",
    originListener: "http://127.0.0.1:8787",
    stableIdentity: "desk-01"
  }, fakeFetch);
  const session = await createPairingSession(config, {
    edgeId: plugin.edge_id,
    ttlSeconds: 180
  }, fakeFetch);
  const refreshed = await getPairingSession(config, session.id, fakeFetch);

  assert.equal(plugin.edge_id, "edge_123");
  assert.equal(session.controller_token, "ctl_123");
  assert.equal(refreshed.status, "claimed");
  assert.deepEqual(
    calls.map((call) => `${call.method} ${call.url}`),
    [
      "POST http://127.0.0.1:8686/v1/plugins",
      "POST http://127.0.0.1:8686/v1/pairing/sessions",
      "GET http://127.0.0.1:8686/v1/pairing/sessions/prs_123"
    ]
  );
});

test("getLatestClaimedPairingSession uses plugin recovery endpoint with controller token", async () => {
  const fakeFetch: typeof fetch = async (input, init) => {
    const request = new Request(input, init);
    assert.equal(
      request.url,
      "http://127.0.0.1:8686/v1/plugins/edge_123/active-pairing"
    );
    assert.equal(request.headers.get("x-zhihand-controller-token"), "ctl_old");
    return jsonResponse({
      session: {
        id: "prs_new",
        edge_id: "edge_123",
        edge_host: "edge-123.edge.zhihand.com",
        pair_url: "https://pair.zhihand.com/pair?d=new",
        qr_payload: "new",
        status: "claimed",
        credential_id: "crd_new",
        created_at: "2026-03-15T00:00:00Z",
        claimed_at: "2026-03-15T00:00:05Z",
        expires_at: "2026-03-15T00:10:00Z"
      },
      controller_token: "ctl_new"
    }, 200);
  };

  const session = await getLatestClaimedPairingSession(
    { controlPlaneEndpoint: "http://127.0.0.1:8686" },
    { edgeId: "edge_123", controllerToken: "ctl_old" },
    fakeFetch
  );

  assert.equal(session.id, "prs_new");
  assert.equal(session.credential_id, "crd_new");
  assert.equal(session.controller_token, "ctl_new");
});

test("getPrompt reads a single mobile prompt through the control plane", async () => {
  const fakeFetch: typeof fetch = async (input, init) => {
    const request = new Request(input, init);
    assert.equal(request.url, "http://127.0.0.1:8686/v1/credentials/crd_123/prompts/prm_123");
    assert.equal(request.headers.get("x-zhihand-controller-token"), "ctl_123");
    return jsonResponse({
      prompt: {
        id: "prm_123",
        credential_id: "crd_123",
        text: "open settings",
        status: "processing",
        client_message_id: "msg-1",
        created_at: "2026-03-15T00:00:00Z"
      }
    }, 200);
  };

  const prompt = await getPrompt(
    { controlPlaneEndpoint: "http://127.0.0.1:8686" },
    {
      credentialId: "crd_123",
      promptId: "prm_123",
      controllerToken: "ctl_123"
    },
    fakeFetch
  );

  assert.equal(prompt.id, "prm_123");
  assert.equal(prompt.status, "processing");
});

test("waitForClaim polls until the session is claimed", async () => {
  let reads = 0;
  const fakeFetch: typeof fetch = async () => {
    reads += 1;
    return jsonResponse({
      session: {
        id: "prs_123",
        edge_id: "edge_123",
        edge_host: "edge-123.edge.zhihand.com",
        pair_url: "https://pair.zhihand.com/pair?d=payload",
        qr_payload: "payload",
        status: reads >= 3 ? "claimed" : "pending",
        credential_id: reads >= 3 ? "crd_123" : undefined,
        created_at: "2026-03-12T00:00:00Z",
        expires_at: "2026-03-12T00:05:00Z"
      }
    }, 200);
  };

  const result = await waitForClaim(
    { controlPlaneEndpoint: "http://127.0.0.1:8686" },
    { sessionId: "prs_123", pollIntervalMs: 1, timeoutMs: 250 },
    fakeFetch
  );

  assert.equal(result.claimed, true);
  assert.equal(result.expired, false);
  assert.equal(result.iterations, 3);
  assert.equal(result.session.credential_id, "crd_123");
});

test("renderPairingQRCodeSVG returns SVG output", async () => {
  const svg = await renderPairingQRCodeSVG("https://pair.zhihand.com/pair?d=payload");
  assert.match(svg, /^<svg[\s>]/);
  assert.match(svg, /<path/);
});

test("enqueueCommand posts controller-authenticated commands", async () => {
  let capturedHeaders: Headers | undefined;
  let capturedBody = "";
  let capturedURL = "";

  const fakeFetch: typeof fetch = async (input, init) => {
    const request = new Request(input, init);
    capturedURL = request.url;
    capturedHeaders = request.headers;
    capturedBody = await request.text();
    return jsonResponse({
      command: {
        id: "cmd_123",
        credential_id: "crd_123",
        status: "pending",
        command: {
          type: "receive_home",
          payload: {},
          message_id: 171024
        },
        created_at: "2026-03-12T00:00:00Z"
      }
    }, 201);
  };

  const command = await enqueueCommand(
    { controlPlaneEndpoint: "http://127.0.0.1:8686" },
    {
      credentialId: "crd_123",
      controllerToken: "ctl_secret",
      command: {
        type: "receive_home",
        payload: {},
        messageId: 171024
      }
    },
    fakeFetch
  );

  assert.equal(capturedURL, "http://127.0.0.1:8686/v1/credentials/crd_123/commands");
  assert.equal(
    capturedHeaders?.get("user-agent"),
    "ZhiHand-OpenClaw/0.6.0 (+https://zhihand.com)"
  );
  assert.equal(capturedHeaders?.get("x-zhihand-controller-token"), "ctl_secret");
  assert.match(capturedBody, /receive_home/);
  assert.equal(command.id, "cmd_123");
});

test("mobile prompt and reply helpers use credential and controller auth correctly", async () => {
  const calls: Array<{ url: string; method: string; headers: Headers; body: string }> = [];
  const fakeFetch: typeof fetch = async (input, init) => {
    const request = new Request(input, init);
    calls.push({
      url: request.url,
      method: request.method,
      headers: request.headers,
      body: request.method === "GET" ? "" : await request.text()
    });

    if (request.method === "POST" && request.url.endsWith("/prompts")) {
      return jsonResponse({
        prompt: {
          id: "prm_123",
          credential_id: "crd_123",
          edge_id: "edge_123",
          text: "open settings",
          status: "pending",
          created_at: "2026-03-13T00:00:00Z"
        }
      }, 201);
    }
    if (request.method === "GET" && request.url.includes("/prompts")) {
      return jsonResponse({
        items: [
          {
            id: "prm_123",
            credential_id: "crd_123",
            edge_id: "edge_123",
            text: "open settings",
            status: "processing",
            created_at: "2026-03-13T00:00:00Z"
          }
        ]
      }, 200);
    }
    return jsonResponse({
      reply: {
        id: "rpy_123",
        prompt_id: "prm_123",
        credential_id: "crd_123",
        edge_id: "edge_123",
        role: "assistant",
        text: "Opening settings now.",
        sequence: 1,
        created_at: "2026-03-13T00:00:01Z"
      }
    }, 201);
  };

  const config = { controlPlaneEndpoint: "http://127.0.0.1:8686" };
  const prompt = await enqueueMobilePrompt(config, {
    credentialId: "crd_123",
    credentialSecret: "cred_secret",
    text: "open settings",
    clientMessageId: "android-msg-1"
  }, fakeFetch);
  const prompts = await listPendingPrompts(config, {
    credentialId: "crd_123",
    controllerToken: "ctl_secret",
    limit: 5
  }, fakeFetch);
  const reply = await createPromptReply(config, {
    credentialId: "crd_123",
    promptId: "prm_123",
    controllerToken: "ctl_secret",
    text: "Opening settings now.",
    runId: "run-1"
  }, fakeFetch);

  assert.equal(prompt.id, "prm_123");
  assert.equal(prompts[0]?.status, "processing");
  assert.equal(reply.sequence, 1);
  assert.equal(
    calls[0]?.headers.get("user-agent"),
    "ZhiHand-OpenClaw/0.6.0 (+https://zhihand.com)"
  );
  assert.equal(calls[0]?.headers.get("authorization"), "Bearer cred_secret");
  assert.equal(calls[1]?.headers.get("x-zhihand-controller-token"), "ctl_secret");
  assert.equal(calls[2]?.headers.get("x-zhihand-controller-token"), "ctl_secret");
});

test("getCommand and waitForCommandAck read ack state through the controller token", async () => {
  let reads = 0;
  const fakeFetch: typeof fetch = async (input, init) => {
    const request = new Request(input, init);
    assert.equal(
      request.headers.get("x-zhihand-controller-token"),
      "ctl_secret"
    );
    reads += 1;
    return jsonResponse({
      command: {
        id: "cmd_123",
        credential_id: "crd_123",
        status: reads >= 2 ? "acked" : "delivered",
        acked_at: reads >= 2 ? "2026-03-12T00:00:03Z" : undefined,
        ack_status: reads >= 2 ? "ok" : undefined,
        ack_result: reads >= 2 ? { live_capture: "already_active" } : undefined,
        command: {
          type: "zhihand.start_live_capture",
          payload: {},
          message_id: 171024
        },
        created_at: "2026-03-12T00:00:00Z"
      }
    }, 200);
  };

  const config = { controlPlaneEndpoint: "http://127.0.0.1:8686" };
  const first = await getCommand(config, {
    credentialId: "crd_123",
    controllerToken: "ctl_secret",
    commandId: "cmd_123"
  }, fakeFetch);
  const waited = await waitForCommandAck(config, {
    credentialId: "crd_123",
    controllerToken: "ctl_secret",
    commandId: "cmd_123",
    timeoutMs: 200,
    pollIntervalMs: 1
  }, fakeFetch);

  assert.equal(first.status, "delivered");
  assert.equal(waited.acked, true);
  assert.equal(waited.command.ack_status, "ok");
  assert.deepEqual(waited.command.ack_result, { live_capture: "already_active" });
});

test("fetchLatestScreenSnapshot returns image metadata, freshness headers, and branded UA", async () => {
  let capturedHeaders: Headers | undefined;
  const fakeFetch: typeof fetch = async (input, init) => {
    const request = new Request(input, init);
    capturedHeaders = request.headers;
    return new Response(
      JSON.stringify({
        snapshot: {
          credential_id: "crd_123",
          edge_id: "edge_123",
          mime_type: "image/jpeg",
          encoding: "base64",
          width: 720,
          height: 1560,
          captured_at: "2026-03-12T00:00:00Z",
          uploaded_at: "2026-03-12T00:00:01Z",
          sequence: 4,
          frame_base64: "ZmFrZS1qcGVn"
        }
      }),
      {
        status: 200,
        headers: {
          "content-type": "application/json",
          "x-snapshot-age": "850",
          "x-snapshot-captured-at": "2026-03-12T00:00:00Z"
        }
      }
    );
  };

  const snapshot = await fetchLatestScreenSnapshot(
    { controlPlaneEndpoint: "http://127.0.0.1:8686" },
    { credentialId: "crd_123", controllerToken: "ctl_secret" },
    fakeFetch
  );

  assert.equal(snapshot.snapshot.sequence, 4);
  assert.equal(snapshot.ageMs, 850);
  assert.equal(snapshot.capturedAt, "2026-03-12T00:00:00Z");
  assert.equal(
    capturedHeaders?.get("user-agent"),
    "ZhiHand-OpenClaw/0.6.0 (+https://zhihand.com)"
  );
});

test("createControlCommand maps OpenClaw actions into Android command payloads", () => {
  assert.deepEqual(
    createControlCommand({ action: "back" }),
    { type: "receive_back", payload: {} }
  );
  assert.deepEqual(
    createControlCommand({ action: "enter" }),
    { type: "receive_enter", payload: {} }
  );
  assert.deepEqual(
    createControlCommand({ action: "click", xRatio: 0.25, yRatio: 0.75 }),
    { type: "receive_click", payload: { x: 0.25, y: 0.75 } }
  );
  assert.deepEqual(
    createControlCommand({ action: "move_to", xRatio: 1.0, yRatio: 0.0 }),
    { type: "receive_moveto", payload: { x: 1.0, y: 0.0 } }
  );
  assert.deepEqual(
    createControlCommand({ action: "move", dxRatio: -1.0, dyRatio: 1.0 }),
    { type: "receive_move", payload: { x: -1.0, y: 1.0 } }
  );
  assert.deepEqual(
    createControlCommand({ action: "input_text", text: "hello" }),
    { type: "receive_input", payload: { input: "hello", mode: "auto", submit: false } }
  );
  assert.deepEqual(
    createControlCommand({ action: "input_text", text: "hello", mode: "paste", submit: true }),
    { type: "receive_input", payload: { input: "hello", mode: "paste", submit: true } }
  );
  assert.deepEqual(
    createControlCommand({ action: "start_live_capture" }),
    { type: "zhihand.start_live_capture", payload: {} }
  );
});

test("createControlCommand rejects out-of-range ratios", () => {
  assert.throws(
    () => createControlCommand({ action: "click", xRatio: 1.01, yRatio: 0.5 }),
    /xRatio must be a normalized ratio in \[0, 1\]/
  );
  assert.throws(
    () => createControlCommand({ action: "move", dxRatio: 1.1, dyRatio: 0 }),
    /dxRatio must be a normalized ratio in \[-1, 1\]/
  );
});

test("buildPairingPrompt includes QR svg and download URL", async () => {
  const prompt = await buildPairingPrompt({
    id: "prs_123",
    edge_id: "edge_123",
    edge_host: "edge-123.edge.zhihand.com",
    pair_url: "https://pair.zhihand.com/pair?d=payload",
    qr_payload: "payload",
    requested_scopes: ["observe", "session.control"],
    status: "pending",
    created_at: "2026-03-12T00:00:00Z",
    expires_at: "2026-03-12T00:05:00Z"
  });

  assert.equal(prompt.appDownloadURL, "https://zhihand.com/download");
  assert.match(prompt.qrSVG, /^<svg[\s>]/);
  assert.match(prompt.body, /scan this QR code/i);
});

function jsonResponse(payload: unknown, status: number): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "content-type": "application/json"
    }
  });
}

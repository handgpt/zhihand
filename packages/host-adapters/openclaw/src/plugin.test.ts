import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import register, {
  formatPairingCommandText,
  hasZhiHandToolBinding,
  isGatewayResponsesReadyStatus,
  reconcilePairingState,
  resolveActivePairingTransition,
  resolveGatewayAuthToken
} from "./plugin.ts";

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

test("hasZhiHandToolBinding recognizes global and agent-scoped tool allowlists", () => {
  assert.equal(
    hasZhiHandToolBinding(
      {
        tools: {
          allow: ["openclaw"]
        }
      },
      "zhihand-mobile"
    ),
    true
  );

  assert.equal(
    hasZhiHandToolBinding(
      {
        agents: {
          list: [
            {
              id: "zhihand-mobile",
              tools: {
                allow: ["zhihand_control"]
              }
            }
          ]
        }
      },
      "zhihand-mobile"
    ),
    true
  );

  assert.equal(
    hasZhiHandToolBinding(
      {
        plugins: {
          allow: ["openclaw"]
        }
      },
      "zhihand-mobile"
    ),
    false
  );
});

test("isGatewayResponsesReadyStatus treats schema/auth failures differently from route failures", () => {
  assert.equal(isGatewayResponsesReadyStatus(200), true);
  assert.equal(isGatewayResponsesReadyStatus(400), true);
  assert.equal(isGatewayResponsesReadyStatus(422), true);
  assert.equal(isGatewayResponsesReadyStatus(401), false);
  assert.equal(isGatewayResponsesReadyStatus(403), false);
  assert.equal(isGatewayResponsesReadyStatus(404), false);
  assert.equal(isGatewayResponsesReadyStatus(500), false);
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

test("reconcilePairingState upgrades stale pending local pairing from active pairing", async () => {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "zhihand-openclaw-state-"));
  const statePath = path.join(stateDir, "plugins", "openclaw", "state.json");
  await fs.mkdir(path.dirname(statePath), { recursive: true });
  await fs.writeFile(
    statePath,
    JSON.stringify(
      {
        pairing: {
          sessionId: "prs_pending",
          controllerToken: "ctl_123",
          edgeId: "edge_123",
          edgeHost: "edge_123.edge.zhihand.com",
          pairUrl: "https://pair.example.com",
          qrPayload: "qr",
          status: "pending",
          expiresAt: "2026-03-21T00:00:00Z"
        }
      },
      null,
      2
    ),
    "utf8"
  );

  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith("/v1/pairing/sessions/prs_pending")) {
      return new Response(
        JSON.stringify({
          session: {
            id: "prs_pending",
            edge_id: "edge_123",
            edge_host: "edge_123.edge.zhihand.com",
            pair_url: "https://pair.example.com",
            qr_payload: "qr",
            status: "pending",
            expires_at: "2026-03-21T00:00:00Z"
          }
        }),
        {
          status: 200,
          headers: {
            "content-type": "application/json"
          }
        }
      );
    }
    if (url.endsWith("/v1/plugins/edge_123/active-pairing")) {
      return new Response(
        JSON.stringify({
          session: {
            id: "prs_pending",
            edge_id: "edge_123",
            edge_host: "edge_123.edge.zhihand.com",
            pair_url: "https://pair.example.com",
            qr_payload: "qr",
            status: "claimed",
            expires_at: "2026-03-21T00:00:00Z",
            credential_id: "crd_123",
            controller_token: "ctl_123"
          },
          controller_token: "ctl_123"
        }),
        {
          status: 200,
          headers: {
            "content-type": "application/json"
          }
        }
      );
    }
    throw new Error(`unexpected fetch ${url}`);
  }) as typeof fetch;

  try {
    const reconciled = await reconcilePairingState({
      logger: {},
      runtime: {
        state: {
          resolveStateDir: () => stateDir
        }
      },
      pluginConfig: {
        controlPlaneEndpoint: "https://api.zhihand.com"
      }
    } as any);

    assert.equal(reconciled?.status, "claimed");
    assert.equal(reconciled?.credentialId, "crd_123");

    const saved = JSON.parse(await fs.readFile(statePath, "utf8"));
    assert.equal(saved.pairing.status, "claimed");
    assert.equal(saved.pairing.credentialId, "crd_123");
  } finally {
    globalThis.fetch = originalFetch;
    await fs.rm(stateDir, { recursive: true, force: true });
  }
});

test("reconcilePairingState stores controller token returned by the claimed session", async () => {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "zhihand-openclaw-state-"));
  const statePath = path.join(stateDir, "plugins", "openclaw", "state.json");
  await fs.mkdir(path.dirname(statePath), { recursive: true });
  await fs.writeFile(
    statePath,
    JSON.stringify(
      {
        pairing: {
          sessionId: "prs_claimed",
          controllerToken: "",
          edgeId: "edge_123",
          edgeHost: "edge_123.edge.zhihand.com",
          pairUrl: "https://pair.example.com",
          qrPayload: "qr",
          status: "pending",
          expiresAt: "2026-03-21T00:00:00Z"
        }
      },
      null,
      2
    ),
    "utf8"
  );

  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith("/v1/pairing/sessions/prs_claimed")) {
      return new Response(
        JSON.stringify({
          session: {
            id: "prs_claimed",
            edge_id: "edge_123",
            edge_host: "edge_123.edge.zhihand.com",
            pair_url: "https://pair.example.com",
            qr_payload: "qr",
            status: "claimed",
            expires_at: "2026-03-21T00:00:00Z",
            credential_id: "crd_123",
            controller_token: "ctl_123"
          }
        }),
        {
          status: 200,
          headers: {
            "content-type": "application/json"
          }
        }
      );
    }
    if (url.endsWith("/v1/plugins/edge_123/active-pairing")) {
      return new Response(
        JSON.stringify({
          session: {
            id: "prs_claimed",
            edge_id: "edge_123",
            edge_host: "edge_123.edge.zhihand.com",
            pair_url: "https://pair.example.com",
            qr_payload: "qr",
            status: "claimed",
            expires_at: "2026-03-21T00:00:00Z",
            credential_id: "crd_123",
            controller_token: "ctl_123"
          },
          controller_token: "ctl_123"
        }),
        {
          status: 200,
          headers: {
            "content-type": "application/json"
          }
        }
      );
    }
    throw new Error(`unexpected fetch ${url}`);
  }) as typeof fetch;

  try {
    const reconciled = await reconcilePairingState({
      logger: {},
      runtime: {
        state: {
          resolveStateDir: () => stateDir
        }
      },
      pluginConfig: {
        controlPlaneEndpoint: "https://api.zhihand.com"
      }
    } as any);

    assert.equal(reconciled?.status, "claimed");
    assert.equal(reconciled?.credentialId, "crd_123");
    assert.equal(reconciled?.controllerToken, "ctl_123");

    const saved = JSON.parse(await fs.readFile(statePath, "utf8"));
    assert.equal(saved.pairing.status, "claimed");
    assert.equal(saved.pairing.credentialId, "crd_123");
    assert.equal(saved.pairing.controllerToken, "ctl_123");
  } finally {
    globalThis.fetch = originalFetch;
    await fs.rm(stateDir, { recursive: true, force: true });
  }
});

test("resolveActivePairingTransition keeps the current relay for pending replacement sessions", () => {
  const active = {
    sessionId: "prs_old",
    controllerToken: "ctl_old",
    edgeId: "edge_123",
    edgeHost: "edge_123.edge.zhihand.com",
    pairUrl: "https://pair.example.com/old",
    qrPayload: "old",
    credentialId: "crd_old",
    status: "claimed",
    expiresAt: "2026-03-22T00:00:00Z"
  };
  const latest = {
    sessionId: "prs_new",
    controllerToken: "ctl_new",
    edgeId: "edge_123",
    edgeHost: "edge_123.edge.zhihand.com",
    pairUrl: "https://pair.example.com/new",
    qrPayload: "new",
    status: "pending",
    expiresAt: "2026-03-22T00:00:00Z"
  };

  assert.deepEqual(resolveActivePairingTransition(active, latest), { kind: "keep" });
});

test("resolveActivePairingTransition switches when a newer claimed credential appears", () => {
  const active = {
    sessionId: "prs_old",
    controllerToken: "ctl_old",
    edgeId: "edge_123",
    edgeHost: "edge_123.edge.zhihand.com",
    pairUrl: "https://pair.example.com/old",
    qrPayload: "old",
    credentialId: "crd_old",
    status: "claimed",
    expiresAt: "2026-03-22T00:00:00Z"
  };
  const latest = {
    sessionId: "prs_new",
    controllerToken: "ctl_new",
    edgeId: "edge_123",
    edgeHost: "edge_123.edge.zhihand.com",
    pairUrl: "https://pair.example.com/new",
    qrPayload: "new",
    credentialId: "crd_new",
    status: "claimed",
    expiresAt: "2026-03-22T00:00:00Z"
  };

  const transition = resolveActivePairingTransition(active, latest);
  assert.equal(transition.kind, "switch");
  if (transition.kind === "switch") {
    assert.equal(transition.next.credentialId, "crd_new");
    assert.match(transition.reason, /pairing advanced/);
  }
});

test("resolveActivePairingTransition stops when pairing state is cleared", () => {
  const active = {
    sessionId: "prs_old",
    controllerToken: "ctl_old",
    edgeId: "edge_123",
    edgeHost: "edge_123.edge.zhihand.com",
    pairUrl: "https://pair.example.com/old",
    qrPayload: "old",
    credentialId: "crd_old",
    status: "claimed",
    expiresAt: "2026-03-22T00:00:00Z"
  };

  const transition = resolveActivePairingTransition(active, null);
  assert.equal(transition.kind, "stop");
  if (transition.kind === "stop") {
    assert.match(transition.reason, /cleared/);
  }
});

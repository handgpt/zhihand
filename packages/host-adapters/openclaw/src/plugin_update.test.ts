import test from "node:test";
import assert from "node:assert/strict";

import {
  buildPluginUpdateStatus,
  comparePluginVersions,
  extractLatestVersionFromRegistryPayload,
  formatAvailablePluginUpdateInstruction,
  formatPluginUpdateDetails,
  formatPluginUpdateSummary,
  normalizeStoredUpdateState
} from "./plugin_update.ts";

test("comparePluginVersions compares semantic versions numerically", () => {
  assert.equal(comparePluginVersions("0.9.0", "0.8.9") > 0, true);
  assert.equal(comparePluginVersions("0.9.0", "0.9.0"), 0);
  assert.equal(comparePluginVersions("0.9.1", "0.10.0") < 0, true);
});

test("buildPluginUpdateStatus reports an available update", () => {
  const status = buildPluginUpdateStatus({
    currentVersion: "0.9.0",
    latestVersion: "0.9.1",
    lastCheckedAt: "2026-03-18T00:00:00Z",
    checkedFrom: "live"
  });

  assert.equal(status.state, "available");
  assert.equal(
    formatPluginUpdateSummary(status),
    "Plugin Update: available (0.9.0 -> 0.9.1)"
  );
});

test("extractLatestVersionFromRegistryPayload prefers dist-tags latest", () => {
  assert.equal(
    extractLatestVersionFromRegistryPayload({
      "dist-tags": {
        latest: "0.9.1"
      },
      version: "0.9.0"
    }),
    "0.9.1"
  );
});

test("formatAvailablePluginUpdateInstruction scopes pinned install to first install", () => {
  const text = formatAvailablePluginUpdateInstruction("0.9.3");

  assert.match(text, /openclaw plugins update openclaw/);
  assert.match(text, /only for a first install or after removing the existing extension directory/);
  assert.match(text, /openclaw plugins install @zhihand\/openclaw@0.9.3/);
});

test("buildPluginUpdateStatus reports a pending restart after install", () => {
  const status = buildPluginUpdateStatus({
    currentVersion: "0.9.0",
    latestVersion: "0.9.1",
    pendingRestartVersion: "0.9.1",
    lastCheckedAt: "2026-03-18T00:00:00Z",
    checkedFrom: "cache"
  });

  assert.equal(status.state, "restart-required");
  assert.match(formatPluginUpdateDetails(status), /Restart the OpenClaw gateway/);
});

test("buildPluginUpdateStatus honors disabled auto checks", () => {
  const status = buildPluginUpdateStatus({
    currentVersion: "0.9.0",
    updateCheckEnabled: false
  });

  assert.equal(status.state, "disabled");
  assert.match(formatPluginUpdateDetails(status), /updateCheckEnabled/);
});

test("normalizeStoredUpdateState clears pending restart once runtime version matches", () => {
  const normalized = normalizeStoredUpdateState({
    currentVersion: "0.9.0",
    update: {
      latestVersion: "0.9.0",
      pendingRestartVersion: "0.9.0",
      lastCheckedAt: "2026-03-18T00:00:00Z"
    }
  });

  assert.equal(normalized.changed, true);
  assert.equal(normalized.update?.pendingRestartVersion, undefined);
});

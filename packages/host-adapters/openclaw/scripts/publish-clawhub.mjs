import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(scriptDir, "..");
const repoRoot = path.resolve(packageRoot, "../../..");
const extraArgs = process.argv.slice(2);

function runAllowFailure(command, args) {
  const result = spawnSync(command, args, { encoding: "utf8" });
  if (result.error) {
    return { ok: false, output: String(result.error) };
  }
  return {
    ok: result.status === 0,
    output: `${result.stdout || ""}${result.stderr || ""}`.trim(),
  };
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

const packageJson = JSON.parse(readFileSync(path.join(packageRoot, "package.json"), "utf8"));
const version =
  typeof packageJson.version === "string" && packageJson.version.trim()
    ? packageJson.version.trim()
    : null;
const repository =
  packageJson.repository && typeof packageJson.repository === "object" ? packageJson.repository : null;
const repositoryUrl =
  repository && typeof repository.url === "string" && repository.url.trim() ? repository.url.trim() : null;
const repositoryDirectory =
  repository && typeof repository.directory === "string" && repository.directory.trim()
    ? repository.directory.trim()
    : null;
const publishName = process.env.ZHIHAND_CLAWHUB_NAME?.trim() || "zhihand";
const displayName = process.env.ZHIHAND_CLAWHUB_DISPLAY_NAME?.trim() || "ZhiHand";
const sourcePath = process.env.ZHIHAND_CLAWHUB_SOURCE_PATH?.trim() || repositoryDirectory || "packages/host-adapters/openclaw";
const sourceRepo =
  process.env.ZHIHAND_CLAWHUB_SOURCE_REPO?.trim() ||
  normalizeGitHubRepo(repositoryUrl) ||
  "handgpt/zhihand";

if (!version) {
  fail("package.json version is required before publishing to ClawHub.");
}

let dirty = "";
try {
  dirty = run("git", ["-C", repoRoot, "status", "--porcelain", "--untracked-files=all", "--", sourcePath]);
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}

if (dirty) {
  fail(
    [
      "Refusing to publish to ClawHub with uncommitted changes under packages/host-adapters/openclaw.",
      "Commit and push the adapter changes first so ClawHub source metadata matches the published files.",
    ].join("\n"),
  );
}

let commit = "";
try {
  commit = run("git", ["-C", repoRoot, "rev-parse", "HEAD"]);
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}

const remoteContains = runAllowFailure("git", ["-C", repoRoot, "branch", "-r", "--contains", commit]);
if (!remoteContains.ok || !remoteContains.output) {
  console.error(
    "Warning: HEAD is not contained in any remote-tracking branch. Push before publishing if you want source-linked verification to resolve this commit.",
  );
}

const packFilename = run("npm", ["pack", "--silent"], {
  cwd: packageRoot,
});
const packPath = path.join(packageRoot, packFilename);
const tempRoot = mkdtempSync(path.join(os.tmpdir(), "zhihand-clawhub-publish-"));
const extractRoot = path.join(tempRoot, "extract");
const stagedRoot = path.join(extractRoot, "package");
const publishArgs = [
  "package",
  "publish",
  stagedRoot,
  "--family",
  "code-plugin",
  "--name",
  publishName,
  "--display-name",
  displayName,
  "--version",
  version,
  "--source-repo",
  sourceRepo,
  "--source-commit",
  commit,
  "--source-path",
  sourcePath,
  ...extraArgs,
];

console.error(
  `Publishing ${publishName}@${version} to ClawHub from ${sourceRepo}@${commit} (source path ${sourcePath})`,
);

try {
  mkdirSync(extractRoot, { recursive: true });
  run("tar", ["-xf", packPath, "-C", extractRoot], {
    cwd: packageRoot,
  });
  const stagedPackageJsonPath = path.join(stagedRoot, "package.json");
  const stagedPackageJson = JSON.parse(readFileSync(stagedPackageJsonPath, "utf8"));
  stagedPackageJson.name = publishName;
  writeFileSync(stagedPackageJsonPath, `${JSON.stringify(stagedPackageJson, null, 2)}\n`, "utf8");

  const publishResult = spawnSync("clawhub", publishArgs, {
    cwd: packageRoot,
    env: process.env,
    stdio: "inherit",
  });

  if (publishResult.error) {
    if ("code" in publishResult.error && publishResult.error.code === "ENOENT") {
      fail("ClawHub CLI not found. Install it with `npm i -g clawhub` before publishing.");
    }
    throw publishResult.error;
  }
  process.exit(publishResult.status ?? 0);
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
  rmSync(packPath, { force: true });
}

function normalizeGitHubRepo(url) {
  if (!url) {
    return null;
  }
  const normalized = url
    .replace(/^git\+/, "")
    .replace(/^git@github\.com:/, "https://github.com/")
    .replace(/\.git$/i, "");
  const match = /^https?:\/\/github\.com\/([^/]+\/[^/]+?)(?:\/)?$/i.exec(normalized);
  return match?.[1] ?? null;
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    ...options,
  });
  if (result.error) {
    if ("code" in result.error && result.error.code === "ENOENT") {
      throw new Error(`Missing required binary: ${command}`);
    }
    throw result.error;
  }
  if (result.status !== 0) {
    const output = `${result.stdout || ""}${result.stderr || ""}`.trim();
    throw new Error(output || `${command} ${args.join(" ")} failed with exit code ${result.status}`);
  }
  return (result.stdout || "").trim();
}

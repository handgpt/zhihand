import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

type PackageMetadata = {
  name: string;
  version: string;
  description: string;
};

const PACKAGE_JSON_URL = new URL("../package.json", import.meta.url);

export const OPENCLAW_PACKAGE_JSON_PATH = fileURLToPath(PACKAGE_JSON_URL);
export const OPENCLAW_PACKAGE_ROOT_DIR = path.dirname(OPENCLAW_PACKAGE_JSON_PATH);

function loadPackageMetadata(): PackageMetadata {
  const raw = fs.readFileSync(OPENCLAW_PACKAGE_JSON_PATH, "utf8");
  const parsed = JSON.parse(raw) as Partial<PackageMetadata>;
  return {
    name: typeof parsed.name === "string" && parsed.name.trim() !== ""
      ? parsed.name.trim()
      : "@zhihand/openclaw",
    version: typeof parsed.version === "string" && parsed.version.trim() !== ""
      ? parsed.version.trim()
      : "0.0.0",
    description: typeof parsed.description === "string" && parsed.description.trim() !== ""
      ? parsed.description.trim()
      : "OpenClaw host adapter for the ZhiHand control model"
  };
}

const PACKAGE_METADATA = loadPackageMetadata();

export const OPENCLAW_PACKAGE_NAME = PACKAGE_METADATA.name;
export const OPENCLAW_PACKAGE_VERSION = PACKAGE_METADATA.version;
export const OPENCLAW_PACKAGE_DESCRIPTION = PACKAGE_METADATA.description;
export const OPENCLAW_USER_AGENT =
  `ZhiHand-OpenClaw/${OPENCLAW_PACKAGE_VERSION} (+https://zhihand.com)`;

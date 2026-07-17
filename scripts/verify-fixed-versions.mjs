#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const FIXED_PACKAGES = new Map([
  ["@kleio/ai", "packages/gg-ai/package.json"],
  ["@kleio/agent", "packages/gg-agent/package.json"],
  ["@kleio/core", "packages/gg-core/package.json"],
  ["@kleio/coder", "packages/ggcoder/package.json"],
  ["@kleio/manager", "packages/gg-boss/package.json"],
]);

async function readJson(relativePath) {
  return JSON.parse(await readFile(join(ROOT, relativePath), "utf8"));
}

function sameMembers(actual, expected) {
  return (
    actual.length === expected.length &&
    [...actual].sort().every((value, index) => value === [...expected].sort()[index])
  );
}

const errors = [];
const provenance = await readJson("fork-provenance.json");
const changesets = await readJson(".changeset/config.json");
const expectedNames = [...FIXED_PACKAGES.keys()];
const expectedVersion = provenance.downstream?.currentFixedVersion;
const declaredReleaseVersions = new Set(Object.values(provenance.releases ?? {}));

if (typeof expectedVersion !== "string" || !/^4\.10\.1-kleio\.\d+$/.test(expectedVersion)) {
  errors.push(
    `fork-provenance.json downstream.currentFixedVersion must be a 4.10.1-kleio.* version; received ${JSON.stringify(expectedVersion)}`,
  );
} else if (!declaredReleaseVersions.has(expectedVersion)) {
  errors.push(
    `fork-provenance.json releases must declare current fixed version ${expectedVersion}`,
  );
}

const matchingFixedGroups = (changesets.fixed ?? []).filter((group) =>
  group.some((name) => FIXED_PACKAGES.has(name)),
);
if (matchingFixedGroups.length !== 1 || !sameMembers(matchingFixedGroups[0] ?? [], expectedNames)) {
  errors.push(
    `Changesets must contain exactly one atomic fixed group with: ${expectedNames.join(", ")}`,
  );
}

const versions = new Map();
for (const [expectedName, manifestPath] of FIXED_PACKAGES) {
  const manifest = await readJson(manifestPath);
  if (manifest.name !== expectedName) {
    errors.push(`${manifestPath} name must be ${expectedName}; received ${manifest.name}`);
  }
  versions.set(expectedName, manifest.version);
  if (manifest.version !== expectedVersion) {
    errors.push(`${manifestPath} version must be ${expectedVersion}; received ${manifest.version}`);
  }
}

if (new Set(versions.values()).size !== 1) {
  errors.push(
    `Fixed package versions drifted: ${[...versions].map(([name, version]) => `${name}=${version}`).join(", ")}`,
  );
}

if (errors.length > 0) {
  console.error("Fixed-version invariant failed:\n");
  for (const error of errors) console.error(`- ${error}`);
  process.exitCode = 1;
} else {
  console.log(`Fixed-version invariant passed: 5 packages at ${expectedVersion}`);
}

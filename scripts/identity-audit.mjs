#!/usr/bin/env node

import { execFile as execFileCallback } from "node:child_process";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFile = promisify(execFileCallback);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const ALLOWLIST_PATH = "scripts/identity-allowlist.json";
const IDENTITY_PATTERN = /kenkaiiii|gg-boss|gg-coder|gg coder|ggboss|ggcoder/giu;
const PACKAGE_DIRS = [
  "packages/gg-ai",
  "packages/gg-agent",
  "packages/gg-core",
  "packages/ggcoder",
  "packages/gg-boss",
];

function parseArguments(argv) {
  const known = new Set(["--packed", "--packed-only", "--report", "--verbose"]);
  const unknown = argv.filter((argument) => !known.has(argument));
  if (unknown.length > 0) throw new Error(`Unknown argument(s): ${unknown.join(", ")}`);
  return {
    scanTracked: !argv.includes("--packed-only"),
    scanPacked: argv.includes("--packed") || argv.includes("--packed-only"),
    reportOnly: argv.includes("--report"),
    verbose: argv.includes("--verbose"),
  };
}

async function readJson(relativePath) {
  return JSON.parse(await readFile(join(ROOT, relativePath), "utf8"));
}

function globToRegExp(glob) {
  let expression = "^";
  for (let index = 0; index < glob.length; index += 1) {
    const character = glob[index];
    if (character === "*") {
      const isDouble = glob[index + 1] === "*";
      if (isDouble) {
        const followedBySlash = glob[index + 2] === "/";
        expression += followedBySlash ? "(?:.*/)?" : ".*";
        index += followedBySlash ? 2 : 1;
      } else {
        expression += "[^/]*";
      }
    } else if (character === "?") {
      expression += "[^/]";
    } else {
      expression += character.replace(/[|\\{}()[\]^$+?.]/g, "\\$&");
    }
  }
  return new RegExp(`${expression}$`);
}

function validateAllowlist(allowlist) {
  if (allowlist.schemaVersion !== 1 || !Array.isArray(allowlist.entries)) {
    throw new Error(`${ALLOWLIST_PATH} must use schemaVersion 1 and contain an entries array`);
  }

  const ids = new Set();
  return allowlist.entries.map((entry, index) => {
    const label = `allowlist entry ${index + 1}`;
    if (!entry.id || ids.has(entry.id)) throw new Error(`${label} must have a unique id`);
    ids.add(entry.id);
    if (!new Set(["compatibility", "provenance"]).has(entry.bucket)) {
      throw new Error(`${entry.id}: bucket must be compatibility or provenance`);
    }
    for (const field of ["owner", "reason", "removeWhen", "path"]) {
      if (typeof entry[field] !== "string" || entry[field].trim() === "") {
        throw new Error(`${entry.id}: ${field} must be a non-empty string`);
      }
    }
    if (
      !Array.isArray(entry.targets) ||
      entry.targets.length === 0 ||
      entry.targets.some((target) => !["tracked", "packed"].includes(target))
    ) {
      throw new Error(`${entry.id}: targets must contain only tracked and/or packed`);
    }
    if (!new Set(["content", "path"]).has(entry.scope)) {
      throw new Error(`${entry.id}: scope must be content or path`);
    }
    if (
      typeof entry.expectedOccurrences !== "object" ||
      entry.expectedOccurrences === null ||
      entry.targets.some(
        (target) =>
          !Number.isInteger(entry.expectedOccurrences[target]) ||
          entry.expectedOccurrences[target] < 0,
      )
    ) {
      throw new Error(
        `${entry.id}: expectedOccurrences must map every target to a non-negative integer`,
      );
    }
    const matchKeys = ["literal", "regex"].filter((key) => key in (entry.match ?? {}));
    if (matchKeys.length !== 1) {
      throw new Error(`${entry.id}: match must contain exactly one literal or regex`);
    }

    const contextPattern =
      matchKeys[0] === "literal"
        ? new RegExp(entry.match.literal.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gu")
        : new RegExp(entry.match.regex, entry.match.flags ?? "giu");
    if (!contextPattern.flags.includes("g")) {
      throw new Error(`${entry.id}: regex flags must include g`);
    }

    return {
      ...entry,
      pathPattern: globToRegExp(entry.path),
      contextPattern,
    };
  });
}

function identitySpans(value) {
  return [...value.matchAll(IDENTITY_PATTERN)].map((match) => ({
    start: match.index,
    end: match.index + match[0].length,
    value: match[0],
  }));
}

function contextSpans(value, pattern) {
  pattern.lastIndex = 0;
  return [...value.matchAll(pattern)].map((match) => ({
    start: match.index,
    end: match.index + match[0].length,
  }));
}

function matchingEntry(entries, occurrence) {
  for (const entry of entries) {
    if (!entry.targets.includes(occurrence.target)) continue;
    if (entry.scope !== occurrence.scope || !entry.pathPattern.test(occurrence.path)) continue;
    const spans = contextSpans(occurrence.context, entry.contextPattern);
    if (spans.some((span) => span.start <= occurrence.start && span.end >= occurrence.end)) {
      return entry;
    }
  }
  return undefined;
}

function countKey(entryId, target) {
  return `${entryId}:${target}`;
}

function incrementCount(counts, entry, target) {
  const key = countKey(entry.id, target);
  counts.set(key, (counts.get(key) ?? 0) + 1);
}

function scanText({ content, path, target, entries, counts, unclassified }) {
  if (content.includes("\0")) return;
  const lines = content.split(/\r?\n/u);
  lines.forEach((line, index) => {
    for (const span of identitySpans(line)) {
      const occurrence = {
        target,
        scope: "content",
        path,
        line: index + 1,
        context: line,
        ...span,
      };
      const entry = matchingEntry(entries, occurrence);
      if (entry) incrementCount(counts, entry, target);
      else unclassified.push(occurrence);
    }
  });
}

function scanPath({ path, target, entries, counts, unclassified }) {
  for (const span of identitySpans(path)) {
    const occurrence = {
      target,
      scope: "path",
      path,
      line: 0,
      context: path,
      ...span,
    };
    const entry = matchingEntry(entries, occurrence);
    if (entry) incrementCount(counts, entry, target);
    else unclassified.push(occurrence);
  }
}

async function trackedPaths() {
  const { stdout } = await execFile(
    "git",
    ["ls-files", "-z", "--cached", "--others", "--exclude-standard"],
    {
      cwd: ROOT,
      encoding: "utf8",
      maxBuffer: 20 * 1024 * 1024,
    },
  );
  return stdout.split("\0").filter(Boolean);
}

function parsePackJson(stdout, packageDir) {
  const firstBracket = stdout.indexOf("[");
  const lastBracket = stdout.lastIndexOf("]");
  if (firstBracket === -1 || lastBracket === -1) {
    throw new Error(`npm pack --dry-run returned no JSON for ${packageDir}`);
  }
  const result = JSON.parse(stdout.slice(firstBracket, lastBracket + 1));
  if (!Array.isArray(result) || !Array.isArray(result[0]?.files)) {
    throw new Error(`npm pack --dry-run returned an unexpected manifest for ${packageDir}`);
  }
  return result[0].files.map((file) => file.path);
}

async function packedPaths(packageDir) {
  const absolutePackageDir = join(ROOT, packageDir);
  const { stdout } = await execFile("npm", ["pack", "--dry-run", "--json", "--ignore-scripts"], {
    cwd: absolutePackageDir,
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
  });
  return parsePackJson(stdout, packageDir).map((path) => ({
    absolutePath: join(absolutePackageDir, path),
    logicalPath: `${packageDir}/${path}`,
  }));
}

const options = parseArguments(process.argv.slice(2));
const allowlist = await readJson(ALLOWLIST_PATH);
const entries = validateAllowlist(allowlist);
const counts = new Map(
  entries.flatMap((entry) => entry.targets.map((target) => [countKey(entry.id, target), 0])),
);
const unclassified = [];
const scannedTargets = new Set();
let scannedFiles = 0;

if (options.scanTracked) {
  scannedTargets.add("tracked");
  for (const path of await trackedPaths()) {
    scanPath({ path, target: "tracked", entries, counts, unclassified });
    const absolutePath = join(ROOT, path);
    let content;
    try {
      content = await readFile(absolutePath, "utf8");
    } catch (error) {
      if (error?.code === "EISDIR") continue;
      throw error;
    }
    scanText({ content, path, target: "tracked", entries, counts, unclassified });
    scannedFiles += 1;
  }
}

if (options.scanPacked) {
  scannedTargets.add("packed");
  for (const packageDir of PACKAGE_DIRS) {
    for (const packedFile of await packedPaths(packageDir)) {
      const content = await readFile(packedFile.absolutePath, "utf8");
      scanText({
        content,
        path: packedFile.logicalPath,
        target: "packed",
        entries,
        counts,
        unclassified,
      });
      scannedFiles += 1;
    }
  }
}

const countMismatches = entries.flatMap((entry) =>
  entry.targets
    .filter((target) => scannedTargets.has(target))
    .filter(
      (target) => counts.get(countKey(entry.id, target)) !== entry.expectedOccurrences[target],
    )
    .map((target) => ({
      id: entry.id,
      target,
      expected: entry.expectedOccurrences[target],
      actual: counts.get(countKey(entry.id, target)),
    })),
);

if (options.verbose || unclassified.length > 0) {
  for (const occurrence of unclassified.slice(0, 250)) {
    const location =
      occurrence.line > 0 ? `${occurrence.path}:${occurrence.line}` : occurrence.path;
    console.error(`UNCLASSIFIED ${occurrence.target} ${location}: ${occurrence.context.trim()}`);
  }
  if (unclassified.length > 250) {
    console.error(`... ${unclassified.length - 250} more unclassified occurrences`);
  }
}

for (const mismatch of countMismatches) {
  console.error(
    `COUNT_MISMATCH ${mismatch.id} (${mismatch.target}): expected ${mismatch.expected}, found ${mismatch.actual}`,
  );
}

if (options.verbose) {
  for (const entry of entries) {
    for (const target of entry.targets) {
      console.log(
        `ALLOWLIST ${entry.id} (${target}): ${counts.get(countKey(entry.id, target))} occurrence(s)`,
      );
    }
  }
}

const status = unclassified.length === 0 && countMismatches.length === 0 ? "passed" : "failed";
console.log(
  `Identity audit ${status}: ${scannedFiles} files, ${unclassified.length} unclassified, ${countMismatches.length} count mismatch(es)`,
);

if (status === "failed" && !options.reportOnly) process.exitCode = 1;

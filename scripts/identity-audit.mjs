#!/usr/bin/env node

import { execFile as execFileCallback } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { lstat, readFile, readdir, realpath } from "node:fs/promises";
import { devNull, tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFile = promisify(execFileCallback);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const ALLOWLIST_PATH = "scripts/identity-allowlist.json";
const IDENTITY_PATTERN = /kenkaiiii|gg-boss|gg-coder|gg coder|ggboss|ggcoder/giu;
export const CANONICAL_PACKAGES = Object.freeze({
  "packages/gg-ai": "@kleio/ai",
  "packages/gg-agent": "@kleio/agent",
  "packages/gg-core": "@kleio/core",
  "packages/ggcoder": "@kleio/coder",
  "packages/gg-boss": "@kleio/manager",
});
const PACKAGE_DIRS = Object.keys(CANONICAL_PACKAGES);

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

async function trackedPaths(root = ROOT, verified = false) {
  const { stdout } = await execFile(
    "git",
    [
      ...(verified ? ["-c", "core.fsmonitor=false", "-c", "core.hooksPath=" + devNull] : []),
      "ls-files",
      "-z",
      "--cached",
      "--others",
      "--exclude-standard",
    ],
    {
      cwd: root,
      ...(verified ? { env: gitEnvironment(), timeout: 30_000 } : {}),
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
  // Windows ships npm as a .cmd shim, which execFile cannot run directly.
  // Invoke Node's bundled npm CLI without a shell; keep lifecycle scripts disabled.
  const command = process.platform === "win32" ? process.execPath : "npm";
  const args = ["pack", "--dry-run", "--json", "--ignore-scripts"];
  if (process.platform === "win32") {
    args.unshift(join(dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js"));
  }
  const { stdout } = await execFile(command, args, {
    cwd: absolutePackageDir,
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
  });
  return parsePackJson(stdout, packageDir).map((path) => ({
    absolutePath: join(absolutePackageDir, path),
    logicalPath: `${packageDir}/${path}`,
  }));
}

async function audit(options, root = ROOT, installedFiles) {
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
    for (const path of await trackedPaths(root, options.verified)) {
      const absolutePath = options.verified ? await containedFile(root, path) : join(root, path);
      let content;
      try {
        content = await readFile(absolutePath, "utf8");
      } catch (error) {
        if (error?.code === "EISDIR" || error?.code === "ENOENT") continue;
        throw error;
      }
      scanPath({ path, target: "tracked", entries, counts, unclassified });
      scanText({ content, path, target: "tracked", entries, counts, unclassified });
      scannedFiles += 1;
    }
  }

  if (options.scanPacked) {
    scannedTargets.add("packed");
    for (const packageDir of PACKAGE_DIRS) {
      for (const packedFile of installedFiles
        ? installedFiles.get(packageDir)
        : await packedPaths(packageDir)) {
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

  const status = unclassified.length === 0 && countMismatches.length === 0 ? "passed" : "failed";
  const result = { status, scannedFiles, unclassified, countMismatches };
  if (options.quiet) return result;
  if (options.verbose || unclassified.length > 0) {
    const reportedOccurrences = options.verbose ? unclassified : unclassified.slice(0, 250);
    for (const occurrence of reportedOccurrences) {
      const location =
        occurrence.line > 0 ? `${occurrence.path}:${occurrence.line}` : occurrence.path;
      // Source maps can be megabytes on one line. Scan them fully, but keep each
      // diagnostic bounded so CI problem matchers cannot stall on the output.
      const start = Math.max(0, occurrence.start - 160);
      const end = Math.min(occurrence.context.length, occurrence.end + 160);
      const context =
        (start > 0 ? "…" : "") +
        occurrence.context.slice(start, end).trim() +
        (end < occurrence.context.length ? "…" : "");
      console.error(`UNCLASSIFIED ${occurrence.target} ${location}: ${context}`);
    }
    if (!options.verbose && unclassified.length > 250) {
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

  console.log(
    `Identity audit ${status}: ${scannedFiles} files, ${unclassified.length} unclassified, ${countMismatches.length} count mismatch(es)`,
  );

  return result;
}

function exactOptions(options, keys) {
  if (
    !options ||
    typeof options !== "object" ||
    Array.isArray(options) ||
    Object.keys(options).length !== keys.length ||
    keys.some((key) => !Object.hasOwn(options, key))
  )
    throw new Error("invalid-audit-options");
}

// Verified-mode git must not read the operator's global config. An empty file is
// used rather than os.devNull because on Windows devNull is the device path
// \\.\nul, which git cannot access() as GIT_CONFIG_GLOBAL.
let emptyGitConfig;
function isolatedGitConfig() {
  if (!emptyGitConfig) {
    emptyGitConfig = join(mkdtempSync(join(tmpdir(), "kleio-identity-audit-")), "gitconfig");
    writeFileSync(emptyGitConfig, "");
  }
  return emptyGitConfig;
}

function gitEnvironment() {
  return {
    PATH: process.env.PATH,
    ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}),
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: isolatedGitConfig(),
    GIT_NO_REPLACE_OBJECTS: "1",
    GIT_NO_LAZY_FETCH: "1",
    GIT_TERMINAL_PROMPT: "0",
  };
}

async function containedFile(root, path) {
  if (
    typeof path !== "string" ||
    !path ||
    /[\p{Cc}\\:]/u.test(path) ||
    path.split("/").some((part) => !part || part === "." || part === "..")
  )
    throw new Error("invalid-audit-path");
  let current = root;
  for (const part of path.split("/")) {
    current = join(current, part);
    if ((await lstat(current)).isSymbolicLink()) throw new Error("symlinked-audit-path");
  }
  const stat = await lstat(current);
  if (!stat.isFile() || stat.size > 32 * 1024 * 1024) throw new Error("invalid-audit-file");
  return current;
}

// The policy is always read beside this trusted module, never from the target.
export async function auditCandidateRepository(options) {
  exactOptions(options, ["root", "expectedSha"]);
  if (typeof options.root !== "string" || !/^[0-9a-f]{40}$/.test(options.expectedSha))
    throw new Error("invalid-audit-candidate");
  const root = await realpath(options.root);
  const { stdout } = await execFile("git", ["-c", "core.fsmonitor=false", "rev-parse", "HEAD"], {
    cwd: root,
    env: gitEnvironment(),
    timeout: 30_000,
    maxBuffer: 1024,
  });
  if (stdout.trim() !== options.expectedSha) throw new Error("audit-head-mismatch");
  return audit({ scanTracked: true, verified: true, quiet: true }, root);
}

export async function auditInstalledPackages(options) {
  exactOptions(options, ["consumerRoot", "packageRoots"]);
  const consumer = await realpath(options.consumerRoot);
  exactOptions(options.packageRoots, Object.values(CANONICAL_PACKAGES));
  const installedFiles = new Map();
  let count = 0;
  let totalBytes = 0;
  for (const [logical, name] of Object.entries(CANONICAL_PACKAGES)) {
    const root = await realpath(options.packageRoots[name]);
    const location = relative(consumer, root);
    if (!location || location.startsWith("..") || isAbsolute(location))
      throw new Error("package-outside-consumer");
    const manifest = JSON.parse(await readFile(await containedFile(root, "package.json"), "utf8"));
    if (manifest.name !== name) throw new Error("installed-package-identity");
    const files = [];
    async function visit(directory, prefix = "") {
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        // Dependencies are not bytes from this canonical tarball.
        if (entry.name === "node_modules") continue;
        if (++count > 100_000) throw new Error("audit-file-limit");
        const path = prefix + entry.name;
        if (entry.isDirectory()) await visit(join(directory, entry.name), path + "/");
        else {
          const absolutePath = await containedFile(root, path);
          totalBytes += (await lstat(absolutePath)).size;
          if (totalBytes > 512 * 1024 * 1024) throw new Error("audit-size-limit");
          files.push({ absolutePath, logicalPath: logical + "/" + path });
        }
      }
    }
    await visit(root);
    installedFiles.set(logical, files);
  }
  return audit({ scanPacked: true, quiet: true }, ROOT, installedFiles);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const options = parseArguments(process.argv.slice(2));
  const result = await audit(options);
  if (result.status === "failed" && !options.reportOnly) process.exitCode = 1;
}

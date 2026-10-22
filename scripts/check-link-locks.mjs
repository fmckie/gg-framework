#!/usr/bin/env node
// Kleio's link (packages/kleio-link) pins iroh, and gg-app builds the link, so
// both Cargo.lock files must name the same versions of iroh, its sub-crates
// and noq: the crates .github/dependabot.yml's "iroh" group moves together.
// One iroh release can open a Dependabot pull request per directory; this
// fails CI until both lockfiles agree, so neither merges alone.
//
//   node scripts/check-link-locks.mjs

import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
export const LOCKFILES = Object.freeze([
  "gg-app/src-tauri/Cargo.lock",
  "packages/kleio-link/Cargo.lock",
]);
/** The Dependabot group's patterns: iroh, iroh-*, noq and noq-*. */
const LINKED = /^(?:iroh|noq)(?:-.+)?$/u;

/**
 * The iroh and noq crates a Cargo.lock names, each as "name version", sorted.
 * A crate locked at two versions counts twice.
 */
export function linkedCrates(lock) {
  const crates = [];
  for (const table of lock.split(/^\[\[package\]\]/mu).slice(1)) {
    const name = /^name = "([^"]+)"\s*$/mu.exec(table)?.[1];
    const version = /^version = "([^"]+)"\s*$/mu.exec(table)?.[1];
    if (name !== undefined && version !== undefined && LINKED.test(name)) {
      crates.push(`${name} ${version}`);
    }
  }
  return crates.sort();
}

/**
 * Compare the two lockfiles under `root`. `onlyApp` and `onlyLink` are the
 * crates one names and the other doesn't; `errors`, a lockfile with no iroh.
 */
export async function checkLinkLocks(root = ROOT) {
  const [app, link] = await Promise.all(
    LOCKFILES.map(async (path) => linkedCrates(await readFile(join(root, path), "utf8"))),
  );
  const errors = [];
  for (const [path, crates] of [
    [LOCKFILES[0], app],
    [LOCKFILES[1], link],
  ]) {
    if (!crates.some((crate) => crate.startsWith("iroh "))) errors.push(`${path} names no iroh`);
  }
  const onlyApp = app.filter((crate) => !link.includes(crate));
  const onlyLink = link.filter((crate) => !app.includes(crate));
  const ok = errors.length === 0 && onlyApp.length === 0 && onlyLink.length === 0;
  return { ok, crates: app, onlyApp, onlyLink, errors };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await checkLinkLocks();
  if (result.ok) {
    console.log(`Link lockfiles agree: ${result.crates.join(", ")}`);
  } else {
    console.error("Link lockfiles disagree on iroh or noq:\n");
    for (const error of result.errors) console.error(`- ${error}`);
    for (const crate of result.onlyApp) console.error(`- only ${LOCKFILES[0]}: ${crate}`);
    for (const crate of result.onlyLink) console.error(`- only ${LOCKFILES[1]}: ${crate}`);
    console.error(
      "\nRun `cargo update -p iroh` (or `-p <crate> --precise <version>`) in the directory " +
        "that is behind, so both name the same versions.",
    );
    process.exitCode = 1;
  }
}

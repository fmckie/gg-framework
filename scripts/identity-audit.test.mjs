import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { CANONICAL_PACKAGES, auditInstalledPackages } from "./identity-audit.mjs";

const script = new URL("./identity-audit.mjs", import.meta.url);
const legacy = "ggcoder";

async function fixture(t) {
  const home = realpathSync.native(mkdtempSync(join(tmpdir(), "kleio-audit-test-")));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const trusted = join(home, "trusted", "scripts");
  mkdirSync(trusted, { recursive: true });
  copyFileSync(script, join(trusted, "identity-audit.mjs"));
  writeFileSync(
    join(trusted, "identity-allowlist.json"),
    JSON.stringify({
      schemaVersion: 1,
      entries: [
        {
          id: "fixture",
          path: "**/contract.txt",
          scope: "content",
          targets: ["packed", "tracked"],
          match: { literal: legacy },
          expectedOccurrences: { packed: 1, tracked: 1 },
          bucket: "compatibility",
          owner: "Test",
          reason: "Exact sentinel",
          removeWhen: "Fixture retirement",
        },
      ],
    }),
  );
  const audit = await import(pathToFileURL(join(trusted, "identity-audit.mjs")));
  const consumerRoot = join(home, "consumer");
  const packageRoots = {};
  for (const name of Object.values(CANONICAL_PACKAGES)) {
    const root = join(consumerRoot, "node_modules", name);
    mkdirSync(root, { recursive: true });
    writeFileSync(join(root, "package.json"), JSON.stringify({ name, version: "1.0.0" }));
    packageRoots[name] = root;
  }
  const sentinel = join(packageRoots["@kleio/core"], "contract.txt");
  writeFileSync(sentinel, legacy);
  return { home, audit, consumerRoot, packageRoots, sentinel };
}

test("import has no CLI execution or argument parsing effects", () => {
  const result = spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `await import(${JSON.stringify(script.href)})`,
      "--",
      "--not-an-audit-option",
    ],
    { encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, "");
  assert.equal(result.stderr, "");
});

test("installed roots reuse classification and exact counts without policy overrides", async (t) => {
  const f = await fixture(t);
  const options = { consumerRoot: f.consumerRoot, packageRoots: f.packageRoots };
  assert.equal((await f.audit.auditInstalledPackages(options)).status, "passed");
  writeFileSync(f.sentinel, legacy + " " + legacy);
  const extra = await f.audit.auditInstalledPackages(options);
  assert.equal(extra.status, "failed");
  assert.deepEqual(extra.countMismatches, [
    { id: "fixture", target: "packed", expected: 1, actual: 2 },
  ]);
  writeFileSync(join(f.packageRoots["@kleio/core"], "unknown.txt"), legacy);
  const unknown = await f.audit.auditInstalledPackages(options);
  assert.equal(unknown.unclassified.length, 1);
  await assert.rejects(
    f.audit.auditInstalledPackages({ ...options, allowlist: { entries: [] } }),
    /invalid-audit-options/,
  );
  await assert.rejects(
    f.audit.auditInstalledPackages({ ...options, reportOnly: true }),
    /invalid-audit-options/,
  );
  await assert.rejects(
    auditInstalledPackages({ ...options, packageRoots: { ...f.packageRoots, arbitrary: f.home } }),
    /invalid-audit-options/,
  );
  const missing = { ...f.packageRoots };
  delete missing["@kleio/core"];
  await assert.rejects(
    f.audit.auditInstalledPackages({ ...options, packageRoots: missing }),
    /invalid-audit-options/,
  );
  await assert.rejects(
    f.audit.auditInstalledPackages({
      ...options,
      packageRoots: { ...f.packageRoots, "@kleio/core": f.home },
    }),
    /package-outside-consumer/,
  );
  writeFileSync(join(f.packageRoots["@kleio/core"], "package.json"), '{"name":"substitute"}');
  await assert.rejects(f.audit.auditInstalledPackages(options), /installed-package-identity/);
});

test("candidate scan requires HEAD and reads only trusted policy", async (t) => {
  const f = await fixture(t);
  const root = join(f.home, "candidate");
  mkdirSync(root);
  function git(args) {
    const result = spawnSync(
      "git",
      [
        "-c",
        "core.hooksPath=" + join(f.home, "no-hooks"),
        "-c",
        "user.name=Fixture",
        "-c",
        "user.email=fixture@localhost",
        ...args,
      ],
      { cwd: root, encoding: "utf8" },
    );
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  }
  git(["init", "--template="]);
  writeFileSync(join(root, "contract.txt"), legacy);
  git(["add", "contract.txt"]);
  git(["commit", "-m", "fixture"]);
  const expectedSha = git(["rev-parse", "HEAD"]);
  assert.equal((await f.audit.auditCandidateRepository({ root, expectedSha })).status, "passed");
  await assert.rejects(
    f.audit.auditCandidateRepository({ root, expectedSha: "f".repeat(40) }),
    /audit-head-mismatch/,
  );
  mkdirSync(join(root, "scripts"));
  writeFileSync(
    join(root, "scripts", "identity-allowlist.json"),
    '{"schemaVersion":1,"entries":[]}',
  );
  writeFileSync(join(root, "contract.txt"), legacy + " " + legacy);
  const result = await f.audit.auditCandidateRepository({ root, expectedSha });
  assert.equal(result.status, "failed");
  assert.equal(result.countMismatches[0].actual, 2);
  await assert.rejects(
    f.audit.auditCandidateRepository({ root, expectedSha, allowlist: "candidate" }),
    /invalid-audit-options/,
  );
});

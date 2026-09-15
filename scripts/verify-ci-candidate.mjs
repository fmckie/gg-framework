#!/usr/bin/env node
// Verification only: fixed public read transports, no publication or write-token path.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { devNull, homedir, tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { CANDIDATE_RECIPE, prepareCandidate } from "./upstream-sync.mjs";
import { auditCandidateRepository } from "./identity-audit.mjs";
import { isolatedEnvironment } from "./consumer-contract.mjs";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const SHA = /^[0-9a-f]{40}$/;
const KEYS = ["base_sha", "upstream_sha", "imported_sha", "candidate_sha"];
const FORK = "fmckie/gg-framework";
const UPSTREAM = "KenKaiii/gg-framework";
const BRANCH = "refs/heads/main";
const GIT_OPTIONS = [
  "-c",
  "core.hooksPath=" + devNull,
  "-c",
  "core.fsmonitor=false",
  "-c",
  "core.autocrlf=false",
  "-c",
  "credential.helper=",
  "-c",
  "http.extraHeader=",
  "-c",
  "http.followRedirects=false",
  "-c",
  "protocol.allow=never",
  "-c",
  "submodule.recurse=false",
  "-c",
  "fetch.fsckObjects=true",
  "-c",
  "transfer.fsckObjects=true",
  "-c",
  "gc.auto=0",
];

function exactKeys(object, keys) {
  assert.ok(
    object &&
      typeof object === "object" &&
      !Array.isArray(object) &&
      Object.keys(object).length === keys.length &&
      keys.every((key) => Object.hasOwn(object, key)),
    "invalid-verification-options",
  );
}

export function candidateMode(inputs, context) {
  assert.ok(
    inputs && typeof inputs === "object" && !Array.isArray(inputs),
    "invalid-candidate-inputs",
  );
  if (Object.keys(inputs).length === 0) return "ordinary";
  exactKeys(inputs, KEYS);
  for (const key of KEYS)
    assert.ok(
      typeof inputs[key] === "string" && SHA.test(inputs[key]),
      "invalid-candidate-input: " + key,
    );
  exactKeys(context, ["repository", "ref", "sha", "event", "workflowRef", "workflowSha"]);
  assert.equal(context.repository, FORK, "untrusted-caller-repository");
  assert.equal(context.ref, BRANCH, "non-default-caller");
  assert.ok(
    ["push", "workflow_dispatch", "schedule"].includes(context.event),
    "privileged-or-untrusted-caller-event",
  );
  assert.equal(inputs.base_sha, context.sha, "base-caller-mismatch");
  assert.equal(context.workflowSha, context.sha, "unpinned-caller-workflow");
  assert.ok(
    typeof context.workflowRef === "string" &&
      context.workflowRef.startsWith(FORK + "/.github/workflows/") &&
      /^[a-zA-Z0-9_-]+\.ya?ml@refs\/heads\/main$/.test(
        context.workflowRef.slice((FORK + "/.github/workflows/").length),
      ),
    "non-default-caller-workflow",
  );
  return "candidate";
}

function git(directory, args, env, { network = false, local = false, allowFailure = false } = {}) {
  const result = spawnSync(
    "git",
    [
      ...GIT_OPTIONS,
      ...(network ? ["-c", "protocol.https.allow=always"] : []),
      ...(local ? ["-c", "protocol.file.allow=always"] : []),
      "-C",
      directory,
      ...args,
    ],
    {
      env: { ...env, GIT_LFS_SKIP_SMUDGE: "1" },
      encoding: "utf8",
      timeout: network ? 120_000 : 60_000,
      maxBuffer: 16 * 1024 * 1024,
      killSignal: "SIGKILL",
      windowsHide: true,
    },
  );
  if (result.error || (!allowFailure && result.status !== 0))
    throw new Error("verification-git-failed: " + args[0]);
  return allowFailure ? result.status : result.stdout.trim();
}

export function assertCandidateIdentity(repo, inputs, tree, env) {
  assert.match(tree, SHA, "invalid-candidate-tree");
  const actual = git(repo, ["show", "-s", "--format=%H%n%T%n%P", inputs.candidate_sha], env).split(
    "\n",
  );
  assert.deepEqual(
    actual,
    [inputs.candidate_sha, tree, inputs.base_sha + " " + inputs.upstream_sha],
    "candidate-identity-mismatch",
  );
}

function materialize(repo, sha, destination, env) {
  assert.match(sha, SHA, "invalid-checkout-sha");
  assert.ok(!existsSync(destination), "checkout-already-exists");
  mkdirSync(dirname(destination), { recursive: true });
  git(
    dirname(destination),
    [
      "clone",
      "--no-local",
      "--no-hardlinks",
      "--no-checkout",
      "--no-tags",
      "--",
      realpathSync(repo),
      destination,
    ],
    env,
    { local: true },
  );
  git(destination, ["checkout", "--detach", "--force", sha], env);
  assert.equal(git(destination, ["rev-parse", "HEAD"], env), sha, "materialized-head-mismatch");
}

function reconstruct(repo, membershipRepo, membershipTip, inputs, destination, env) {
  assert.match(membershipTip, SHA, "invalid-membership-tip");
  for (const sha of [inputs.upstream_sha, membershipTip])
    assert.equal(
      git(membershipRepo, ["cat-file", "-t", sha], env),
      "commit",
      "non-commit-membership",
    );
  assert.equal(
    git(membershipRepo, ["merge-base", "--is-ancestor", inputs.upstream_sha, membershipTip], env, {
      allowFailure: true,
    }),
    0,
    "rewritten-upstream-membership",
  );
  const report = prepareCandidate({
    repo,
    base: inputs.base_sha,
    upstream: inputs.upstream_sha,
    imported: inputs.imported_sha,
    keepCandidate: true,
  });
  try {
    assert.equal(
      report.status,
      "candidate-ready",
      "preparation-rejected: " + JSON.stringify(report.failures),
    );
    assert.equal(report.recipe, CANDIDATE_RECIPE, "candidate-recipe-mismatch");
    assert.equal(report.candidate, inputs.candidate_sha, "expected-candidate-mismatch");
    assertCandidateIdentity(report.candidateDirectory, inputs, report.tree, env);
    materialize(report.candidateDirectory, inputs.candidate_sha, destination, env);
    assertCandidateIdentity(destination, inputs, report.tree, env);
    return {
      mode: "candidate",
      sha: report.candidate,
      tree: report.tree,
      parents: [inputs.base_sha, inputs.upstream_sha],
      recipe: report.recipe,
      membershipTip,
      directory: realpathSync(destination),
    };
  } finally {
    if (report.candidateDirectory)
      rmSync(dirname(report.candidateDirectory), { recursive: true, force: true });
  }
}

// Offline fixture/inspection entry. There is deliberately no URL or transport callback option.
export function reconstructLocal(options) {
  exactKeys(options, ["repo", "upstreamRepo", "inputs", "context", "destination"]);
  assert.equal(
    candidateMode(options.inputs, options.context),
    "candidate",
    "candidate-inputs-required",
  );
  const temporary = mkdtempSync(join(tmpdir(), "kleio-verify-local-"));
  try {
    const env = isolatedEnvironment(temporary);
    const tip = git(options.upstreamRepo, ["rev-parse", "HEAD"], env);
    return reconstruct(
      options.repo,
      options.upstreamRepo,
      tip,
      options.inputs,
      options.destination,
      env,
    );
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}

// Public mode can contact only these two constant HTTPS endpoints. The advertised
// default tip supplies membership evidence, never a moving build input.
export function reconstructPublic(options) {
  exactKeys(options, ["inputs", "context", "destination"]);
  assert.equal(
    candidateMode(options.inputs, options.context),
    "candidate",
    "candidate-inputs-required",
  );
  const temporary = mkdtempSync(join(tmpdir(), "kleio-verify-public-"));
  try {
    const env = isolatedEnvironment(join(temporary, "home"));
    const repo = join(temporary, "source.git");
    git(temporary, ["init", "--bare", "--template=", repo], env);
    const forkUrl = "https://github.com/" + FORK + ".git";
    const upstreamUrl = "https://github.com/" + UPSTREAM + ".git";
    const advertised = git(repo, ["ls-remote", "--symref", upstreamUrl, "HEAD"], env, {
      network: true,
    }).split("\n");
    assert.equal(advertised.length, 2, "invalid-upstream-advertisement");
    assert.match(
      advertised[0],
      /^ref: refs\/heads\/[a-zA-Z0-9_./-]+\tHEAD$/,
      "invalid-upstream-default-ref",
    );
    assert.match(advertised[1], /^[0-9a-f]{40}\tHEAD$/, "invalid-upstream-advertised-tip");
    const tip = advertised[1].split("\t")[0];
    const fetchArgs = ["fetch", "--no-tags", "--no-recurse-submodules", "--no-write-fetch-head"];
    git(repo, [...fetchArgs, forkUrl, options.inputs.base_sha, options.inputs.imported_sha], env, {
      network: true,
    });
    git(repo, [...fetchArgs, upstreamUrl, options.inputs.upstream_sha, tip], env, {
      network: true,
    });
    return reconstruct(repo, repo, tip, options.inputs, options.destination, env);
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}

function githubContext() {
  return {
    repository: process.env.GITHUB_REPOSITORY,
    ref: process.env.GITHUB_REF,
    sha: process.env.GITHUB_SHA,
    event: process.env.GITHUB_EVENT_NAME,
    workflowRef: process.env.GITHUB_WORKFLOW_REF,
    workflowSha: process.env.GITHUB_WORKFLOW_SHA,
  };
}

function runShell(kind, script) {
  assert.ok(kind === "bash" && script, "invalid-ci-shell");
  assert.ok(
    process.env.KLEIO_CI_ROOT && SHA.test(process.env.KLEIO_CI_SHA ?? ""),
    "missing-verified-checkout",
  );
  assert.ok(["ordinary", "candidate"].includes(process.env.KLEIO_CI_MODE), "missing-ci-mode");
  const workdir = relative(realpathSync(process.env.KLEIO_CI_ROOT), realpathSync(process.cwd()));
  assert.ok(!workdir.startsWith("..") && !isAbsolute(workdir), "execution-directory-mismatch");
  const temporary = mkdtempSync(join(tmpdir(), "kleio-ci-child-"));
  try {
    const env =
      process.env.KLEIO_CI_MODE === "ordinary"
        ? { ...process.env }
        : isolatedEnvironment(temporary);
    assert.equal(
      git(process.env.KLEIO_CI_ROOT, ["rev-parse", "HEAD"], env),
      process.env.KLEIO_CI_SHA,
      "execution-head-mismatch",
    );
    // Toolchain caches are non-secret hosted-runner storage. No job/service tokens
    // or Actions command-file paths enter candidate children.
    for (const key of [
      "RUSTUP_HOME",
      "CARGO_HOME",
      "RUSTUP_TOOLCHAIN",
      "PNPM_HOME",
      "CC",
      "CXX",
      "SDKROOT",
      "MACOSX_DEPLOYMENT_TARGET",
      "VCToolsInstallDir",
      "VCINSTALLDIR",
      "VSINSTALLDIR",
      "WindowsSdkDir",
      "WindowsSDKVersion",
      "INCLUDE",
      "LIB",
      "LIBPATH",
    ])
      if (process.env[key]) env[key] = process.env[key];
    env.RUSTUP_HOME ??= join(homedir(), ".rustup");
    env.CARGO_HOME ??= join(homedir(), ".cargo");
    env.GITHUB_WORKSPACE = process.env.KLEIO_CI_ROOT;
    // These non-secret signals authorize public registry reads on hosted runners.
    env.GITHUB_ACTIONS = process.env.GITHUB_ACTIONS;
    env.RUNNER_ENVIRONMENT = process.env.RUNNER_ENVIRONMENT;
    env.KLEIO_CI_SHA = process.env.KLEIO_CI_SHA;
    env.KLEIO_CI_ROOT = process.env.KLEIO_CI_ROOT;
    env.KLEIO_CONTROL_ROOT = ROOT;
    // Existing framework installs retain their reviewed lifecycle behavior;
    // pack/consumer install suppression is explicit inside the separate harness.
    delete env.npm_config_ignore_scripts;
    const args = ["--noprofile", "--norc", "-e", "-o", "pipefail", script];
    const result = spawnSync(kind, args, {
      cwd: process.cwd(),
      env,
      stdio: "inherit",
      timeout: 30 * 60_000,
      killSignal: "SIGKILL",
    });
    if (result.error || result.status !== 0) throw new Error("ci-child-failed");
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}

async function main(args) {
  if (args[0] === "shell" && args.length === 3) return runShell(args[1], args[2]);
  assert.deepEqual(args, ["materialize"], "invalid-verifier-arguments");
  assert.ok(
    process.env.GITHUB_ACTIONS === "true" && process.env.RUNNER_ENVIRONMENT === "github-hosted",
    "hosted-runner-required",
  );
  const inputs = JSON.parse(process.env.CANDIDATE_INPUTS ?? "{}");
  const context = githubContext();
  const mode = candidateMode(inputs, context);
  const temporary = mkdtempSync(join(tmpdir(), "kleio-control-check-"));
  try {
    const env = isolatedEnvironment(temporary);
    assert.match(context.sha, SHA, "invalid-control-sha");
    assert.equal(git(ROOT, ["rev-parse", "HEAD"], env), context.sha, "control-checkout-unpinned");
    const destination = join(dirname(ROOT.replace(/[\\/]$/, "")), "subject");
    let report;
    if (mode === "candidate") {
      report = reconstructPublic({ inputs, context, destination });
      const audit = await auditCandidateRepository({ root: destination, expectedSha: report.sha });
      assert.equal(audit.status, "passed", "trusted-candidate-identity-audit-failed");
    } else {
      materialize(ROOT, context.sha, destination, env);
      report = { mode, sha: context.sha, directory: realpathSync(destination) };
    }
    // Only trusted, validated scalar values go to Actions command files.
    for (const value of [report.directory, report.sha, report.mode])
      assert.ok(!/[\r\n]/.test(value), "invalid-ci-output");
    appendFileSync(process.env.GITHUB_OUTPUT, `mode=${report.mode}\nsha=${report.sha}\n`);
    appendFileSync(
      process.env.GITHUB_ENV,
      `KLEIO_CI_ROOT=${report.directory}\nKLEIO_CI_SHA=${report.sha}\nKLEIO_CI_MODE=${report.mode}\n`,
    );
    console.log(JSON.stringify(report));
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    await main(process.argv.slice(2));
  } catch (error) {
    console.error(JSON.stringify({ status: "rejected", reason: error.message.slice(0, 4000) }));
    process.exitCode = 1;
  }
}

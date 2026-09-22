import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { realpathSync } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

// Native realpath: on Windows the consumer may be reached through an 8.3 alias
// (C:\\Users\\RUNNER~1) while resolved modules come back with the long name.
const consumer = realpathSync.native(dirname(fileURLToPath(import.meta.url)));
const outcomes = [];
async function contract(name, action) {
  try {
    await action();
    outcomes.push({ contract: name, status: "passed" });
  } catch (error) {
    throw new Error(name + ": " + error.message, { cause: error });
  }
}
async function publicImport(specifier) {
  const path = realpathSync.native(fileURLToPath(import.meta.resolve(specifier)));
  const location = relative(consumer, path);
  assert.ok(
    location && !location.startsWith("..") && !isAbsolute(location),
    "module-outside-consumer",
  );
  return import(specifier);
}

for (const name of ["@kleio/coder", "@kenkaiiii/ggcoder"]) {
  await contract(name + ":imports", async () => {
    const root = await publicImport(name);
    for (const member of [
      "SessionManager",
      "AgentSession",
      "AuthStorage",
      "createTools",
      "buildSystemPrompt",
    ])
      assert.equal(typeof root[member], "function", member);
    const models = await publicImport(name + "/models");
    assert.ok(models.MODELS.length > 0, "model-registry-empty");
    const model = models.getDefaultModel("anthropic");
    assert.equal(model.provider, "anthropic");
    assert.deepEqual(models.getModel(model.id), model);
    assert.ok(models.getModelsForProvider("anthropic").some((entry) => entry.id === model.id));
    assert.equal(models.getModel("missing-consumer-fixture-model"), undefined);
    const auth = await publicImport(name + "/auth");
    for (const member of [
      "AuthStorage",
      "NotLoggedInError",
      "loginAnthropic",
      "loginOpenAI",
      "refreshAnthropicToken",
      "refreshOpenAIToken",
    ])
      assert.equal(typeof auth[member], "function", member);
  });
  await contract(name + ":sessions", async () => {
    const { SessionManager } = await publicImport(name);
    const store = join(consumer, "sessions-" + randomUUID());
    const cwd = join(consumer, "project-" + randomUUID());
    await mkdir(cwd);
    const manager = new SessionManager(store);
    for (const summary of [false, true]) {
      const session = await manager.create(cwd, "anthropic", "consumer-model");
      const raw = summary
        ? "[Previous conversation summary]\nEarlier context"
        : "  Refactor\tthe\n\nauth flow  ";
      for (const content of [raw, "A later human prompt"]) {
        const id = randomUUID();
        await manager.appendEntry(session.path, {
          type: "message",
          id,
          parentId: null,
          timestamp: new Date().toISOString(),
          message: { role: "user", content },
        });
        await manager.updateLeaf(session.path, id);
      }
      assert.ok(
        (await readFile(session.path, "utf8")).split("\n").filter(Boolean).length >= 3,
        "real-jsonl-required",
      );
      const reopened = new SessionManager(store);
      const loaded = await reopened.load(session.path);
      assert.ok(loaded, "session-reopen");
      const listed = (await reopened.list(cwd)).find((entry) => entry.path === session.path);
      assert.ok(listed, "session-list");
      assert.equal(listed.firstPrompt, raw, "firstPrompt");
      assert.equal(
        listed.preview,
        summary ? "A later human prompt" : "Refactor the auth flow",
        "preview",
      );
    }
  });
}

await contract("product-profile", async () => {
  const core = await publicImport("@kleio/core");
  const profile = core.KLEIO_PRODUCT_PROFILE;
  assert.equal(profile.brandName, "Kleio");
  assert.equal(profile.coder.displayName, "Kleio Coder");
  assert.equal(profile.manager.displayName, "Kleio Manager");
  assert.equal(profile.coder.preferredCommand, "kleio-coder");
  assert.equal(profile.manager.preferredCommand, "kleio-manager");
  assert.equal(profile.coder.legacyCommand, "ggcoder");
  assert.equal(profile.manager.legacyCommand, "ggboss");
  assert.equal(profile.coder.agentHomeId, "ggcoder");
  assert.equal(profile.coder.legacyMcpClientName, "ggcoder");
  assert.equal(profile.coder.httpUserAgent, "KleioCoder/1.0");
  assert.equal(profile.coder.legacyHttpUserAgent, "Mozilla/5.0 (compatible; GGCoder/1.0)");
  assert.equal(core.KLEIO_CODER_ERROR_DISPLAY.productName, "Kleio Coder");
  assert.equal(core.KLEIO_MANAGER_ERROR_DISPLAY.productName, "Kleio Manager");
  const resolveAlias = core.resolveEnvironmentAlias;
  assert.equal(
    resolveAlias({ PREFERRED: "new", LEGACY: "old" }, "PREFERRED", "LEGACY"),
    "new",
    "preferred-precedence",
  );
  assert.equal(
    resolveAlias({ PREFERRED: "", LEGACY: "old" }, "PREFERRED", "LEGACY"),
    "",
    "empty-preferred-precedence",
  );
  assert.equal(resolveAlias({ LEGACY: "old" }, "PREFERRED", ["LEGACY"]), "old", "legacy-fallback");
  assert.equal(resolveAlias({}, "PREFERRED", "LEGACY"), undefined);
});

await contract("installed-cli", async () => {
  for (const [name, commands, branding] of [
    ["@kleio/coder", ["kleio-coder", "ggcoder"], "Kleio Coder"],
    ["@kleio/manager", ["kleio-manager", "ggboss"], "Kleio Manager"],
  ]) {
    const root = realpathSync.native(join(consumer, "node_modules", name));
    const manifest = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
    assert.equal(manifest.version, "5.60.2-kleio.1", "fixed-version");
    for (const command of commands) {
      assert.equal(manifest.bin[command], "./dist/cli.js", "bin-target");
      for (const flag of ["--help", "--version"]) {
        const home = join(consumer, "cli-home-" + randomUUID());
        await mkdir(home);
        const result = spawnSync(process.execPath, [join(root, manifest.bin[command]), flag], {
          cwd: consumer,
          env: {
            ...process.env,
            HOME: home,
            USERPROFILE: home,
            XDG_CONFIG_HOME: home,
            APPDATA: home,
            LOCALAPPDATA: home,
          },
          encoding: "utf8",
          timeout: 30_000,
          maxBuffer: 256 * 1024,
          killSignal: "SIGKILL",
        });
        assert.equal(result.status, 0, command + " " + flag + ": " + result.stderr);
        assert.ok(
          (result.stdout + result.stderr).includes(flag === "--help" ? branding : "5.60.2-kleio.1"),
          command + " output",
        );
      }
    }
  }
});
console.log(JSON.stringify({ outcomes }));

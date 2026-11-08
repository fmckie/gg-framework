import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createAskUserTool } from "../tools/ask-user.js";
import { encodeCwd } from "./encode-cwd.js";
import {
  GOAL_HOLD_OPTION,
  GOAL_START_OPTION,
  createGoal,
  deleteGoal,
  goalKickoffPrompt,
  goalPhase,
  isGoalStartAnswer,
  markGoalStarted,
  setGoalCritterModel,
  goalSlug,
  isGoalDir,
  listGoals,
  markGoalKickoff,
  readGoal,
  renderGoalPrompt,
} from "./goals-store.js";

const NOW = new Date("2026-10-10T12:00:00.000Z");

describe("goals store", () => {
  let tmp: string;
  let root: string;

  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), "gg-goals-"));
    root = path.join(tmp, "goals");
  });

  afterEach(async () => {
    await fs.rm(tmp, { recursive: true, force: true });
  });

  it("creates a goal folder with a validated record and resolved context kinds", async () => {
    const repo = path.join(tmp, "api");
    const spec = path.join(tmp, "spec.md");
    await fs.mkdir(repo);
    await fs.writeFile(spec, "# spec");

    const created = await createGoal(
      root,
      { name: "  API Latency ", goal: "Bring p95 under 200 ms", context: [repo, spec, repo] },
      NOW,
    );

    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(created.value.dir).toBe(path.join(root, "api-latency"));
    expect(created.value.record).toEqual({
      schemaVersion: 1,
      id: "api-latency",
      name: "API Latency",
      goal: "Bring p95 under 200 ms",
      context: [
        { path: repo, kind: "folder" },
        { path: spec, kind: "file" },
      ],
      createdAt: NOW.toISOString(),
    });
    expect(await readGoal(created.value.dir)).toEqual(created.value.record);
  });

  it("suffixes a taken folder name instead of overwriting the first goal", async () => {
    const first = await createGoal(root, { name: "Perf", goal: "a" }, NOW);
    const second = await createGoal(root, { name: "perf!", goal: "b" }, NOW);
    expect(first.ok && first.value.record.id).toBe("perf");
    expect(second.ok && second.value.record.id).toBe("perf-2");
    expect((await listGoals(root)).map((g) => g.record.goal)).toEqual(["a", "b"]);
  });

  it("rejects missing fields and relative or missing context paths", async () => {
    expect(await createGoal(root, { name: " ", goal: "x" }, NOW)).toEqual({
      ok: false,
      error: "Give the goal a name",
    });
    expect(await createGoal(root, { name: "x", goal: "" }, NOW)).toEqual({
      ok: false,
      error: "Describe the goal",
    });
    const relative = await createGoal(root, { name: "x", goal: "y", context: ["src"] }, NOW);
    expect(relative.ok).toBe(false);
    const missing = path.join(tmp, "nope");
    expect(await createGoal(root, { name: "x", goal: "y", context: [missing] }, NOW)).toEqual({
      ok: false,
      error: `Not found: ${missing}`,
    });
    expect(await listGoals(root)).toEqual([]);
  });

  it("caps new names at 15 characters but still reads older, longer ones", async () => {
    expect(await createGoal(root, { name: "x".repeat(16), goal: "g" }, NOW)).toEqual({
      ok: false,
      error: "Keep the name to 15 characters",
    });
    const dir = path.join(root, "legacy");
    await fs.mkdir(dir, { recursive: true });
    const legacy = {
      schemaVersion: 1,
      id: "legacy",
      name: "A much longer name than fifteen",
      goal: "g",
      context: [],
      createdAt: NOW.toISOString(),
    };
    await fs.writeFile(path.join(dir, "goal.json"), JSON.stringify(legacy));
    expect((await readGoal(dir))?.name).toBe(legacy.name);
  });

  it("deletes a goal's folder and its sessions but never its context", async () => {
    const repo = path.join(tmp, "repo");
    await fs.mkdir(repo);
    const sessionsDir = path.join(tmp, "sessions");
    const created = await createGoal(root, { name: "Gone", goal: "g", context: [repo] }, NOW);
    if (!created.ok) throw new Error(created.error);
    const sessions = path.join(sessionsDir, encodeCwd(created.value.dir));
    await fs.mkdir(sessions, { recursive: true });
    await fs.writeFile(path.join(sessions, "s.jsonl"), "{}\n");

    expect(await deleteGoal(root, sessionsDir, "gone")).toEqual({
      ok: true,
      value: { dir: created.value.dir },
    });

    await expect(fs.stat(created.value.dir)).rejects.toThrow();
    await expect(fs.stat(sessions)).rejects.toThrow();
    expect((await fs.stat(repo)).isDirectory()).toBe(true);
  });

  it("refuses to delete anything that is not a goal folder", async () => {
    const sessionsDir = path.join(tmp, "sessions");
    await fs.mkdir(path.join(root, "plain"), { recursive: true });
    for (const id of ["", "..", "../goals", "plain", "missing", "a/b"]) {
      expect(await deleteGoal(root, sessionsDir, id)).toEqual({
        ok: false,
        error: "Unknown goal",
      });
    }
    expect((await fs.stat(path.join(root, "plain"))).isDirectory()).toBe(true);
  });

  it("starts a goal only on the start answer, and only once", async () => {
    const created = await createGoal(root, { name: "Go", goal: "g" }, NOW);
    if (!created.ok) throw new Error(created.error);
    expect(goalPhase(created.value.record)).toBe("briefing");

    expect(isGoalStartAnswer({ action: "answer", answers: { q: GOAL_START_OPTION } })).toBe(true);
    expect(
      isGoalStartAnswer({
        action: "answer",
        answers: { q: [` ${GOAL_START_OPTION.toUpperCase()}`] },
      }),
    ).toBe(true);
    expect(isGoalStartAnswer({ action: "answer", answers: { q: GOAL_HOLD_OPTION } })).toBe(false);
    expect(isGoalStartAnswer({ action: "cancel" })).toBe(false);

    const started = await markGoalStarted(created.value.dir, NOW);
    expect(started && goalPhase(started)).toBe("active");
    expect(await markGoalStarted(created.value.dir, NOW)).toBeNull();
    expect((await readGoal(created.value.dir))?.startedAt).toBe(NOW.toISOString());
  });

  it("pins and clears the workers' model on the goal", async () => {
    const created = await createGoal(root, { name: "Pick", goal: "g" }, NOW);
    if (!created.ok) throw new Error(created.error);
    const pinned = await setGoalCritterModel(created.value.dir, {
      provider: "anthropic",
      model: "claude-sonnet-5-5",
    });
    expect(pinned?.critterModel).toEqual({ provider: "anthropic", model: "claude-sonnet-5-5" });
    expect((await readGoal(created.value.dir))?.critterModel?.model).toBe("claude-sonnet-5-5");
    const cleared = await setGoalCritterModel(created.value.dir, null);
    expect(cleared && "critterModel" in cleared).toBe(false);
    expect(await setGoalCritterModel(path.join(root, "missing"), null)).toBeNull();
  });

  it("marks the kickoff exactly once", async () => {
    const created = await createGoal(root, { name: "Once", goal: "g" }, NOW);
    if (!created.ok) throw new Error(created.error);
    const later = new Date("2026-10-10T12:01:00.000Z");
    const first = await markGoalKickoff(created.value.dir, later);
    expect(first?.kickoffAt).toBe(later.toISOString());
    expect(await markGoalKickoff(created.value.dir, later)).toBeNull();
  });

  it("skips folders without a valid goal record", async () => {
    await fs.mkdir(path.join(root, "junk"), { recursive: true });
    await fs.writeFile(path.join(root, "junk", "goal.json"), "{not json");
    expect(await listGoals(root)).toEqual([]);
  });

  it("only treats a direct child of the goals root as a goal folder", () => {
    expect(isGoalDir(root, path.join(root, "perf"))).toBe(true);
    expect(isGoalDir(root, root)).toBe(false);
    expect(isGoalDir(root, path.join(root, "perf", "nested"))).toBe(false);
    expect(isGoalDir(root, path.join(tmp, "elsewhere"))).toBe(false);
  });

  it("slugs names into safe folder names", () => {
    expect(goalSlug("Site Performance!")).toBe("site-performance");
    expect(goalSlug("../../etc")).toBe("etc");
    expect(goalSlug("???")).toBe("");
  });

  it("renders a brief that carries the goal and its context", async () => {
    const created = await createGoal(root, { name: "Brief", goal: "Ship it" }, NOW);
    if (!created.ok) throw new Error(created.error);
    const brief = renderGoalPrompt(created.value.dir, created.value.record);
    expect(brief).toContain('coordinating the goal "Brief"');
    expect(brief).toContain("Ship it");
    expect(brief).toContain("(none attached yet)");
    expect(goalKickoffPrompt(created.value.record)).toContain("Brief");
  });

  it("briefs before working and ends on a start question ask_user accepts", async () => {
    const created = await createGoal(root, { name: "Gate", goal: "g" }, NOW);
    if (!created.ok) throw new Error(created.error);
    const brief = renderGoalPrompt(created.value.dir, created.value.record);
    expect(brief).toContain(`"${GOAL_START_OPTION}"`);
    expect(brief).toContain(`"${GOAL_HOLD_OPTION}"`);
    expect(goalKickoffPrompt(created.value.record)).toContain("Do not start the work");

    // Neither label may trip ask_user's "defers back to the user" guard.
    const asked: unknown[] = [];
    const tool = createAskUserTool(async (request) => {
      asked.push(request);
      return { action: "answer", answers: { start: GOAL_START_OPTION } };
    });
    const result = await tool.execute(
      {
        questions: [
          {
            id: "start",
            question: "Ready to start?",
            kind: "choice",
            options: [{ label: GOAL_START_OPTION, recommended: true }, { label: GOAL_HOLD_OPTION }],
          },
        ],
      },
      {} as Parameters<typeof tool.execute>[1],
    );
    expect(asked).toHaveLength(1);
    expect(String(result)).not.toMatch(/^Error/);
  });
});

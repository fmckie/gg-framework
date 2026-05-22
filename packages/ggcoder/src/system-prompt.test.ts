import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildSystemPrompt } from "./system-prompt.js";
import type { LanguageId } from "./core/language-detector.js";

const tempDirs: string[] = [];

async function makeProject(files: Record<string, string> = {}): Promise<string> {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "ggcoder-system-prompt-"));
  tempDirs.push(cwd);
  for (const [relativePath, content] of Object.entries(files)) {
    const filePath = path.join(cwd, relativePath);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, content, "utf-8");
  }
  return cwd;
}

function sectionIndex(prompt: string, heading: string): number {
  const index = prompt.indexOf(heading);
  expect(index, `${heading} should exist`).toBeGreaterThanOrEqual(0);
  return index;
}

function toolsSection(prompt: string): string {
  const start = sectionIndex(prompt, "## Tools");
  const rest = prompt.slice(start);
  const next = rest.indexOf("\n\n## ", "## Tools".length);
  return next === -1 ? rest : rest.slice(0, next);
}

function promptSize(prompt: string): { characters: number; lines: number; sections: number } {
  return {
    characters: prompt.length,
    lines: prompt.split("\n").length,
    sections: prompt.match(/^## /gm)?.length ?? 0,
  };
}

function promptAudit(prompt: string): { size: ReturnType<typeof promptSize>; flags: string[] } {
  const flags: string[] = [];
  const obsoleteOrContradictory = [
    "## Goal Auto-Continuation Events",
    "[event:goal_worker_complete]",
    "what observable artifact would prove the requested outcome worked end-to-end",
    "the simplest reliable local/free proof path",
    "generic tests, scripts, screenshots, benchmarks, or simulations; use them by default",
  ];

  for (const phrase of obsoleteOrContradictory) {
    if (prompt.includes(phrase)) flags.push(`obsolete/contradictory guidance: ${phrase}`);
  }

  const repeatedSentences = new Map<string, number>();
  for (const sentence of prompt
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+/)
    .map((item) => item.trim())
    .filter((item) => item.length >= 80)) {
    repeatedSentences.set(sentence, (repeatedSentences.get(sentence) ?? 0) + 1);
  }
  for (const [sentence, count] of repeatedSentences) {
    if (count > 1) flags.push(`duplicate sentence x${count}: ${sentence}`);
  }

  return { size: promptSize(prompt), flags };
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe("buildSystemPrompt", () => {
  it("renders deterministic section order and keeps only the volatile date after the marker", async () => {
    const cwd = await makeProject({
      "CLAUDE.md": "Project rules win.",
      "package.json": JSON.stringify({ scripts: { check: "tsc --noEmit" } }),
      "tsconfig.json": "{}",
    });

    const prompt = await buildSystemPrompt(
      cwd,
      [{ name: "find-skills", description: "Find skills.", content: "", source: "test" }],
      false,
      undefined,
      ["read", "edit", "web_search", "enter_plan", "exit_plan", "skill"],
      new Set<LanguageId>(["typescript"]),
    );

    expect(prompt.startsWith("You are GG Coder by Ken Kai")).toBe(true);
    expect(sectionIndex(prompt, "## How to Talk")).toBeLessThan(
      sectionIndex(prompt, "## How to Work"),
    );
    expect(sectionIndex(prompt, "## How to Work")).toBeLessThan(
      sectionIndex(prompt, "## Research & Verification"),
    );
    expect(sectionIndex(prompt, "## Research & Verification")).toBeLessThan(
      sectionIndex(prompt, "## Code Quality"),
    );
    expect(prompt).not.toContain("## Goal Auto-Continuation Events");
    expect(prompt).not.toContain("[event:goal_worker_complete]");
    expect(prompt).toContain("model the intended experience");
    expect(prompt).toContain("choose the required senses/signals");
    expect(prompt).toContain(
      "Do not default to generic tests, scripts, screenshots, benchmarks, or simulations",
    );
    expect(sectionIndex(prompt, "## Code Quality")).toBeLessThan(sectionIndex(prompt, "## Tools"));
    expect(sectionIndex(prompt, "## Tools")).toBeLessThan(
      sectionIndex(prompt, "## Project Context"),
    );
    expect(sectionIndex(prompt, "## Project Context")).toBeLessThan(
      sectionIndex(prompt, "## Language Style Packs"),
    );
    expect(sectionIndex(prompt, "## Language Style Packs")).toBeLessThan(
      sectionIndex(prompt, "## Verification"),
    );
    expect(sectionIndex(prompt, "## Verification")).toBeLessThan(sectionIndex(prompt, "## Skills"));
    expect(sectionIndex(prompt, "## Skills")).toBeLessThan(sectionIndex(prompt, "## Environment"));

    const marker = "<!-- uncached -->";
    expect(prompt.match(new RegExp(marker, "g"))).toHaveLength(1);
    const afterMarker = prompt.slice(prompt.indexOf(marker) + marker.length).trim();
    expect(afterMarker).toMatch(/^Today's date: \d{1,2} [A-Za-z]+ \d{4}$/);
  });

  it("lists exactly available known tools and hides unavailable plan transition tools", async () => {
    const cwd = await makeProject();

    const normalPrompt = await buildSystemPrompt(cwd, undefined, false, undefined, [
      "read",
      "web_search",
      "exit_plan",
      "not_a_tool",
    ]);
    const normalTools = toolsSection(normalPrompt);
    expect(normalTools).toContain("**read**");
    expect(normalTools).toContain("**web_search**");
    expect(normalTools).not.toContain("**exit_plan**");
    expect(normalTools).not.toContain("not_a_tool");
    expect(normalTools).not.toContain("**edit**");

    const planPrompt = await buildSystemPrompt(cwd, undefined, true, undefined, [
      "read",
      "enter_plan",
      "exit_plan",
    ]);
    const planTools = toolsSection(planPrompt);
    expect(planTools).toContain("**read**");
    expect(planTools).toContain("**exit_plan**");
    expect(planTools).not.toContain("**enter_plan**");
  });

  it("places project-context precedence next to project context before style packs", async () => {
    const cwd = await makeProject({
      "AGENTS.md": "Use tabs for this fixture.",
      "tsconfig.json": "{}",
    });

    const prompt = await buildSystemPrompt(
      cwd,
      undefined,
      false,
      undefined,
      ["read"],
      new Set<LanguageId>(["typescript"]),
    );

    const projectContextIndex = sectionIndex(prompt, "## Project Context");
    const precedenceIndex = prompt.indexOf("**Highest precedence**", projectContextIndex);
    expect(precedenceIndex).toBeGreaterThan(projectContextIndex);
    expect(precedenceIndex).toBeLessThan(sectionIndex(prompt, "### AGENTS.md"));
    expect(sectionIndex(prompt, "## Project Context")).toBeLessThan(
      sectionIndex(prompt, "## Language Style Packs"),
    );
    expect(prompt).toContain(
      "AGENTS.md / CLAUDE.md and other project rules override default guidance",
    );
  });

  it("preserves critical operating rules concisely", async () => {
    const cwd = await makeProject({ "AGENTS.md": "Project rules win." });
    const prompt = await buildSystemPrompt(cwd, undefined, true, undefined, [
      "read",
      "edit",
      "write",
      "bash",
      "web_search",
      "web_fetch",
      "source_path",
      "mcp__kencode-search__referenceSources",
      "mcp__kencode-search__discoverRepos",
      "mcp__kencode-search__searchCode",
      "exit_plan",
    ]);

    for (const required of [
      "works directly in the user's codebase",
      "completing tasks end-to-end",
      "at most one short sentence",
      "Final replies: 1–3 sentences, hard cap 5",
      "Read before `edit`/`write`",
      "re-read after formatters",
      "Compute in bash; write with `edit`/`write`",
      "Match neighbors",
      "Keep edits small",
      "Do routine follow-up yourself",
      "Ask first for destructive actions",
      "Preserve user work",
      "Rule precedence: project context files",
      "Do not assume APIs",
      "Use `source_path`",
      "web_search` then `web_fetch",
      "ReferenceSources",
      "DiscoverRepos",
      "SearchCode literal text/RE2 (not semantic)",
      "Restricted: bash, edit, write except .gg/plans/",
      "End the plan with exactly `## Steps`",
      "Never claim unrun or failing checks passed",
    ]) {
      expect(prompt).toContain(required);
    }
  });

  it("keeps kencode guidance concise while separating repo discovery from exact search", async () => {
    const cwd = await makeProject();
    const prompt = await buildSystemPrompt(cwd, undefined, false, undefined, [
      "mcp__kencode-search__referenceSources",
      "mcp__kencode-search__discoverRepos",
      "mcp__kencode-search__searchCode",
    ]);
    const tools = toolsSection(prompt);

    expect(tools).toContain("curated, categorized reference repos");
    expect(tools).toContain("Search GitHub repos live");
    expect(tools).toContain("returns metadata, not snippets");
    expect(tools).toContain("literal text or RE2 regex");
    expect(tools).toContain("NOT semantic");
    expect(tools).toContain("path` is a literal file-path substring");
    expect(tools).not.toContain("zero hits, every time");
    expect(tools.length).toBeLessThan(950);
  });

  it("measures representative system prompt sizes", async () => {
    const normalCwd = await makeProject();
    const normalPrompt = await buildSystemPrompt(normalCwd, undefined, false, undefined, [
      "read",
      "edit",
      "bash",
      "enter_plan",
      "exit_plan",
    ]);

    const planModePrompt = await buildSystemPrompt(normalCwd, undefined, true, undefined, [
      "read",
      "grep",
      "find",
      "ls",
      "web_search",
      "web_fetch",
      "source_path",
      "mcp__kencode-search__referenceSources",
      "mcp__kencode-search__discoverRepos",
      "mcp__kencode-search__searchCode",
      "enter_plan",
      "exit_plan",
    ]);

    const typescriptCwd = await makeProject({
      "AGENTS.md": "Prefer strict TypeScript. Run the focused test before reporting completion.",
      "package.json": JSON.stringify({
        scripts: {
          test: "vitest",
          typecheck: "tsc --noEmit",
        },
        devDependencies: {
          typescript: "^5.0.0",
          vitest: "^3.0.0",
        },
      }),
      "tsconfig.json": JSON.stringify({ compilerOptions: { strict: true } }),
    });
    const typescriptPrompt = await buildSystemPrompt(
      typescriptCwd,
      [
        {
          name: "find-skills",
          description: "Find and install agent skills from the open ecosystem.",
          content: "Use this when the user asks whether a skill exists for a task.",
          source: "test-fixture",
        },
      ],
      false,
      undefined,
      [
        "read",
        "edit",
        "bash",
        "grep",
        "find",
        "ls",
        "web_search",
        "web_fetch",
        "source_path",
        "skill",
        "mcp__kencode-search__referenceSources",
        "mcp__kencode-search__discoverRepos",
        "mcp__kencode-search__searchCode",
        "enter_plan",
        "exit_plan",
      ],
      new Set<LanguageId>(["typescript"]),
    );

    const measurements = {
      normal: promptSize(normalPrompt),
      planMode: promptSize(planModePrompt),
      typescriptProjectContextToolsSkills: promptSize(typescriptPrompt),
    };

    console.info(`system prompt size measurements: ${JSON.stringify(measurements)}`);

    expect(measurements.normal.characters).toBeLessThan(4_800);
    expect(measurements.planMode.characters).toBeLessThan(6_500);
    expect(measurements.typescriptProjectContextToolsSkills.characters).toBeLessThan(9_500);
    expect(measurements.planMode.characters).toBeGreaterThan(measurements.normal.characters);
    expect(measurements.typescriptProjectContextToolsSkills.characters).toBeGreaterThan(
      measurements.normal.characters,
    );
  });

  it("audits representative prompts for obsolete, duplicate, or contradictory guidance", async () => {
    const cwd = await makeProject({
      "AGENTS.md": "Prefer project-specific rules.",
      "package.json": JSON.stringify({ scripts: { test: "vitest" } }),
      "tsconfig.json": "{}",
    });
    const prompt = await buildSystemPrompt(
      cwd,
      [{ name: "find-skills", description: "Find skills.", content: "", source: "test" }],
      false,
      undefined,
      [
        "read",
        "edit",
        "write",
        "bash",
        "web_search",
        "web_fetch",
        "source_path",
        "skill",
        "mcp__kencode-search__referenceSources",
        "mcp__kencode-search__discoverRepos",
        "mcp__kencode-search__searchCode",
        "enter_plan",
        "exit_plan",
      ],
      new Set<LanguageId>(["typescript"]),
    );

    const audit = promptAudit(prompt);
    console.info(`system prompt audit: ${JSON.stringify(audit)}`);

    expect(audit.flags).toEqual([]);
    expect(audit.size.characters).toBeLessThan(9_500);
    expect(audit.size.sections).toBeGreaterThanOrEqual(8);
  });
});

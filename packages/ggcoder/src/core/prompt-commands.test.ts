import { describe, expect, it } from "vitest";
import { PROMPT_COMMANDS } from "./prompt-commands.js";

describe("prompt commands", () => {
  it("defines /goal as a durable loop that discourages report-only worker tasks", () => {
    const goal = PROMPT_COMMANDS.find((command) => command.name === "goal");

    expect(goal).toBeDefined();
    expect(goal?.description).toContain("programmatic goal loop");
    expect(goal?.prompt).toContain("Persist the run with the goals tool");
    expect(goal?.prompt).toContain("Build a capability/evidence plan before implementation");
    expect(goal?.prompt).toContain("evidence_plan items");
    expect(goal?.prompt).toContain("Only ask the user for true external blockers");
    expect(goal?.prompt).toContain('named "User prerequisites" in the pane');
    expect(goal?.prompt).toContain(
      "The user may provide the missing value or instructions in chat",
    );
    expect(goal?.prompt).toContain("verify it locally without revealing secrets");
    expect(goal?.prompt).toContain("Do not require a script for every task");
    expect(goal?.prompt).toContain("choose the simplest reliable proof");
    expect(goal?.prompt).toContain("Do not use the normal tasks tool for this workflow");
    expect(goal?.prompt).toContain("Each Goal task prompt must be standalone");
    expect(goal?.prompt).toContain('Avoid pure "investigate and report" tasks');
    expect(goal?.prompt).toContain('goals({ action: "evidence"');
    expect(goal?.prompt).toContain("creating or updating the next implementation task");
    expect(goal?.prompt).toContain("briefly say what the orchestrator is doing");
    expect(goal?.prompt).toContain(
      "take the next durable control-loop action rather than merely narrating",
    );
    expect(goal?.prompt).toContain("only complete after verification passes");
    expect(goal?.prompt).toContain("give the user a concise final summary in chat");
    expect(goal?.prompt).toContain("compact 3–4 column table");
  });

  it("defines /source as a plan-research-adjust-verify command", () => {
    const source = PROMPT_COMMANDS.find((command) => command.name === "source");

    expect(source).toBeDefined();
    expect(source?.aliases).toEqual(["depcheck", "depsource"]);
    expect(source?.description).toContain("Plan, source-check, adjust, and verify");
    expect(source?.prompt).toContain("# Source: Plan → Research → Adjust → Verify");
    expect(source?.prompt).toContain("Do a short, private plan");
    expect(source?.prompt).toContain("call `source_path` before making claims");
    expect(source?.prompt).toContain("Spawn the research sub-agents in parallel");
    expect(source?.prompt).toContain("fix all confirmed issues directly");
    expect(source?.prompt).toContain("Run the relevant project checks");
    expect(source?.prompt).not.toContain("Do not start implementing until the user chooses");
    expect(source?.prompt).not.toContain("Report only");
  });

  it("defines /expand as a fresh, repo-validated comparison command", () => {
    const expand = PROMPT_COMMANDS.find((command) => command.name === "expand");

    expect(expand).toBeDefined();
    expect(expand?.prompt).toContain("Spawn exactly 5 sub-agents in parallel");
    expect(expand?.prompt).toContain("updated within the last 6 months");
    expect(expand?.prompt).toContain("validate it yourself before reporting");
    expect(expand?.prompt).toContain("The table must have exactly 3 columns");
    expect(expand?.prompt).toContain("Do not start implementing until the user chooses");
    expect(expand?.prompt).toContain("Do not create planning tasks");
    expect(expand?.prompt).not.toContain("Create an implementation plan first");
    expect(expand?.prompt).not.toContain("create one planning task");
    expect(expand?.prompt).not.toContain("plan mode");
  });

  it("keeps /init focused on project-specific CLAUDE.md content", () => {
    const init = PROMPT_COMMANDS.find((command) => command.name === "init");

    expect(init).toBeDefined();
    expect(init?.prompt).toContain("project-specific context only");
    expect(init?.prompt).toContain("Do NOT add generic agent behavior");
    expect(init?.prompt).toContain("Remove generic guidance");
    expect(init?.prompt).toContain(
      "Do not duplicate language style packs or generic verification rules",
    );
    expect(init?.prompt).toContain("Do NOT embed generated symbol maps");
    expect(init?.prompt).toContain("generated repo maps");
    expect(init?.prompt).toContain("CLAUDE.md must remain durable, agent-focused project context");
    expect(init?.prompt).not.toContain("human-authored");
    expect(init?.prompt).not.toContain("one file per component");
    expect(init?.prompt).not.toContain("single responsibility");
    expect(init?.prompt).not.toContain("zero-tolerance code quality checks");
  });
});

import { describe, expect, it } from "vitest";
import { buildBossSystemPrompt } from "./boss-system-prompt.js";

const projects = [
  { name: "atlas", cwd: "/work/atlas" },
  { name: "framework", cwd: "/work/framework" },
];

describe("buildBossSystemPrompt", () => {
  it("uses the Kleio Manager and Kleio Coder worker identities", () => {
    const prompt = buildBossSystemPrompt(projects);
    const identity = prompt.slice(0, prompt.indexOf("\n\n# Projects you control"));

    expect(identity).toMatchInlineSnapshot(
      `"You are Kleio Manager, an orchestrator. The user talks only to you. You drive multiple Kleio Coder workers — one per project — by deciding what to ask each one, monitoring progress, verifying their work, and reporting back."`,
    );
    expect(prompt).toContain('- "atlas" → /work/atlas');
    expect(prompt).toContain("Kleio Manager handles that");
    expect(prompt).toContain("Cancelled by Kleio Manager.");
  });

  it("preserves the orchestration event and tool names", () => {
    const prompt = buildBossSystemPrompt(projects);
    const eventNames = [...new Set([...prompt.matchAll(/\[event:([a-z_]+)\]/g)].map((m) => m[1]))];
    const toolNames = [...prompt.matchAll(/^- `([a-z_]+)\([^`]*\)` —/gm)].map((m) => m[1]);

    expect(eventNames).toEqual(["worker_turn_complete", "worker_error", "worker_stuck"]);
    expect(toolNames).toEqual([
      "list_workers",
      "get_worker_status",
      "prompt_worker",
      "get_worker_summary",
      "get_worker_activity",
      "cancel_worker",
      "reset_worker",
      "add_task",
      "list_tasks",
      "update_task",
      "dispatch_pending",
    ]);
  });
});

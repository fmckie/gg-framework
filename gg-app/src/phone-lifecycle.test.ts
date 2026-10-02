import { describe, expect, it } from "vitest";
import { needsRehydrate, type RehydrateMemory } from "./phone-lifecycle";

const fresh = (): RehydrateMemory => ({ hydratedWhileRunning: false });

describe("needsRehydrate", () => {
  it("reloads the chat when the host could not replay everything missed", () => {
    const memory = fresh();

    expect(needsRehydrate(memory, { kind: "event", type: "kleio_replay_gap" })).toBe(true);
  });

  it("ignores ordinary agent events", () => {
    const memory = fresh();

    expect(needsRehydrate(memory, { kind: "event", type: "text_delta" })).toBe(false);
  });

  it("reloads once a reply that was already running when the chat opened finishes", () => {
    // Opening a chat mid-reply shows the finished messages, then streams the
    // rest live; the start of the reply in progress only arrives with a reload.
    const memory = fresh();
    needsRehydrate(memory, { kind: "hydrated", running: true });

    expect(needsRehydrate(memory, { kind: "running", running: false })).toBe(true);
    expect(needsRehydrate(memory, { kind: "running", running: false })).toBe(false);
  });

  it("does not reload after a reply that started while watching", () => {
    const memory = fresh();
    needsRehydrate(memory, { kind: "hydrated", running: false });
    needsRehydrate(memory, { kind: "running", running: true });

    expect(needsRehydrate(memory, { kind: "running", running: false })).toBe(false);
  });
});

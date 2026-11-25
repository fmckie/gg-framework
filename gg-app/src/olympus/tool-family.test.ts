import { describe, expect, it } from "vitest";
import { activityParts, toolFamilyOf } from "./tool-family";

describe("toolFamilyOf", () => {
  // Every verb the coder's formatToolActivity writes.
  it.each([
    ["Reading src/a.ts", "look"],
    ["Writing src/a.ts", "make"],
    ["Editing src/a.ts", "make"],
    ['Searching for "rateLimit("', "look"],
    ['Finding "*throttle*.ts"', "look"],
    ["Listing src/http", "look"],
    ["Running pnpm test", "run"],
    ["Fetching nodejs.org/api/crypto.html", "web"],
    ["Resolving source for zod", "look"],
    ["Searching web for constant-time comparison", "web"],
    ["Reading task output bg-1", "think"],
    ["Stopping task bg-1", "think"],
    ["Loading skill durable", "think"],
  ] as const)("reads %j as %s", (activity, family) => {
    expect(toolFamilyOf(activity)).toBe(family);
  });

  // Every tool in the mockup's families, as a spawned agent's activity names it.
  it.each([
    ["read", "look"],
    ["grep", "look"],
    ["find", "look"],
    ["ls", "look"],
    ["code_search", "look"],
    ["source_path", "look"],
    ["web_search", "web"],
    ["web_fetch", "web"],
    ["steroids", "web"],
    ["write", "make"],
    ["edit", "make"],
    ["bash", "run"],
  ] as const)("reads the raw tool %s as %s", (tool, family) => {
    expect(toolFamilyOf(`${tool}: something`)).toBe(family);
    expect(toolFamilyOf(tool)).toBe(family);
  });

  it.each([undefined, "", " {2}", "skill: durable", "mcp__gg__ask_user: hi", "Thinking it over"])(
    "reads %j as think",
    (activity) => {
      expect(toolFamilyOf(activity)).toBe("think");
    },
  );

  it("does not take a longer word for a verb or a tool", () => {
    expect(toolFamilyOf("Readingsrc/a.ts")).toBe("think");
    expect(toolFamilyOf("bashful: no")).toBe("think");
  });
});

describe("activityParts", () => {
  it("splits a verb from its subject", () => {
    expect(activityParts("Reading src/a.ts")).toEqual({
      family: "look",
      lead: "Reading",
      subject: "src/a.ts",
    });
    expect(activityParts("Reading task output bg-1").subject).toBe("bg-1");
  });

  it("drops the verb's quotes from a pattern", () => {
    expect(activityParts('Searching for "rateLimit("').subject).toBe("rateLimit(");
    expect(activityParts('Finding "*.ts"').subject).toBe("*.ts");
  });

  it("keeps a web search and a raw activity whole", () => {
    expect(activityParts("Searching web for login lockout")).toEqual({
      family: "web",
      lead: "Searching web for login lockout",
    });
    expect(activityParts("read: src/a.ts")).toEqual({ family: "look", lead: "read: src/a.ts" });
  });

  it("has nothing to say for no activity", () => {
    expect(activityParts(undefined)).toEqual({ family: "think", lead: "" });
  });
});

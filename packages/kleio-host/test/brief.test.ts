import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  composeBrief,
  createBriefing,
  gistOf,
  speakable,
  spokenDuration,
  spokenName,
  type BriefJob,
  type BriefOutcome,
} from "../src/brief.js";
import type { LiveState } from "../src/live-activity.js";

const S0 = 1_790_000_000; // unix seconds

function job(
  target: string,
  kind: BriefJob["kind"],
  title: string,
  state: Partial<LiveState>,
): BriefJob {
  return {
    target,
    kind,
    title,
    state: { phase: "working", line: "Thinking…", startedAt: S0, ...state },
  };
}

function outcome(o: Partial<BriefOutcome> & Pick<BriefOutcome, "target">): BriefOutcome {
  return {
    kind: "specialist",
    title: "Chef",
    phase: "done",
    startedAt: S0 - 600,
    endedAt: S0 - 60,
    ...o,
  };
}

describe("speakable", () => {
  it("turns markdown into sentences to read aloud", () => {
    const md = [
      "## Tonight",
      "",
      "- **Pasta** with `garlic`",
      "- [Recipe](https://example.com/r) see https://x.y/z",
      "",
      "```ts",
      "const x = 1;",
      "```",
      "| a | b |",
      "|---|---|",
      "> Enjoy!",
    ].join("\n");
    expect(speakable(md)).toBe("Tonight. Pasta with garlic. Recipe see a link. a b. Enjoy!");
  });
});

describe("gistOf", () => {
  it("keeps whole first sentences that fit, and never splits a file name", () => {
    expect(gistOf("Fixed the bug in host.ts. Tests pass. Then a long tail…", 30)).toBe(
      "Fixed the bug in host.ts.",
    );
    expect(gistOf("Done! All good?", 100)).toBe("Done! All good?");
  });

  it("clips one long sentence at a word, with an ellipsis", () => {
    const g = gistOf(`One ${"very ".repeat(60)}long sentence`, 40);
    expect(g.length).toBeLessThanOrEqual(40);
    expect(g.endsWith("…")).toBe(true);
    expect(g).not.toMatch(/\s…$/);
  });
});

describe("spokenName / spokenDuration", () => {
  it("names jobs the way you'd say them", () => {
    expect(spokenName("code", "gg-framework")).toBe("Code in gg-framework");
    expect(spokenName("code", "Code")).toBe("A coding job");
    expect(spokenName("specialist", "Chef")).toBe("Chef");
    expect(spokenName("group", "Launch")).toBe("The Launch group");
    expect(spokenName("group", "Launch team")).toBe("The Launch team");
    expect(spokenName("group", "")).toBe("A group");
    expect(spokenName("chat", "Kleio")).toBe("Kleio");
    expect(spokenName("chat", "Chat")).toBe("A chat");
  });

  it("says durations in round words", () => {
    expect(spokenDuration(30)).toBe("a minute");
    expect(spokenDuration(25 * 60)).toBe("25 minutes");
    expect(spokenDuration(65 * 60)).toBe("an hour");
    expect(spokenDuration(90 * 60)).toBe("an hour and a half");
    expect(spokenDuration(5 * 3600)).toBe("5 hours");
    expect(spokenDuration(30 * 3600)).toBe("over a day");
  });
});

describe("composeBrief", () => {
  it("is quiet when there is nothing to say", () => {
    const b = composeBrief({ current: [], outcomes: [], since: S0 - 3600, now: S0 });
    expect(b.items).toEqual([]);
    expect(b.spoken).toMatch(/^All quiet\./);
  });

  it("says what needs you first, then failures, finishes and what's working", () => {
    const b = composeBrief({
      current: [
        job("s:c1", "code", "gg-framework", { line: "Running a command", startedAt: S0 - 120 }),
        job("g:g1", "group", "Launch", {
          phase: "needsYou",
          line: "Needs your help",
          detail: "Ada: Which logo should we use? (+1 more)",
          startedAt: S0 - 300,
        }),
      ],
      outcomes: [
        outcome({ target: "s:b1", gist: "Here are three dinner ideas." }),
        outcome({
          target: "s:b2",
          title: "Scout",
          phase: "failed",
          gist: "Claude usage limit reached.",
          endedAt: S0 - 30,
        }),
      ],
      since: S0 - 3600,
      now: S0,
    });
    expect(b.items.map((i) => `${i.phase}:${i.name}`)).toEqual([
      "needsYou:The Launch group",
      "failed:Scout",
      "done:Chef",
      "working:Code in gg-framework",
    ]);
    expect(b.spoken).toBe(
      "The Launch group needs you. Ada: Which logo should we use? " +
        "Scout failed. Claude usage limit reached. " +
        "Chef finished. Here are three dinner ideas. " +
        "Code in gg-framework is working. Running a command.",
    );
  });

  it("skips what was already heard, and a job that has started again is told as working", () => {
    const b = composeBrief({
      current: [job("s:b1", "specialist", "Chef", { startedAt: S0 - 10 })],
      outcomes: [
        outcome({ target: "s:b1", gist: "Old news." }),
        outcome({ target: "s:b2", title: "Scout", endedAt: S0 - 7200 }),
      ],
      since: S0 - 3600,
      now: S0,
    });
    expect(b.spoken).toBe("Nothing needs you right now. Chef is working.");
  });

  it("names a few of each and counts the rest; a long job says how long", () => {
    const outcomes = ["a", "b", "c", "d", "e"].map((n, i) =>
      outcome({ target: `s:${n}`, title: n.toUpperCase(), endedAt: S0 - 100 + i }),
    );
    const b = composeBrief({
      current: [job("s:x", "code", "api", { startedAt: S0 - 2 * 3600 })],
      outcomes,
      since: S0 - 3600,
      now: S0,
    });
    expect(b.spoken).toBe(
      "Nothing needs you right now. E finished. D finished. C finished. 2 more finished. " +
        "Code in api has been working for 2 hours.",
    );
  });
});

describe("createBriefing", () => {
  let dir: string;
  let clock: number;
  const statePath = (): string => join(dir, "brief.json");
  const make = (): ReturnType<typeof createBriefing> =>
    createBriefing({ statePath: statePath(), now: () => clock * 1000 });
  const frame = (type: string, data: Record<string, unknown> = {}): string =>
    `id: 1\ndata: ${JSON.stringify({ type, data })}`;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "kleio-brief-"));
    clock = S0;
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("keeps how a job ended with the start of its last message", () => {
    const b = make();
    b.onFrame("b1", frame("run_start"));
    b.onFrame("b1", frame("text_delta", { text: "Let me look." }));
    b.onFrame("b1", frame("tool_call_start", { name: "read" }));
    b.onFrame("b1", frame("tool_call_end"));
    b.onFrame("b1", frame("text_delta", { text: "**Done.** Three dinner " }));
    b.onFrame("b1", frame("text_delta", { text: "ideas are ready." }));
    b.ended(
      job("s:b1", "specialist", "Chef", {
        phase: "done",
        line: "Done",
        startedAt: S0 - 300,
        endedAt: S0,
      }),
    );
    expect(b.brief([]).spoken).toBe(
      "Nothing needs you right now. Chef finished. Done. Three dinner ideas are ready.",
    );
  });

  it("says why a job failed, and leaves out quick chats and anything stopped", () => {
    const b = make();
    b.onFrame("c1", frame("run_start"));
    b.onFrame(
      "c1",
      frame("error", { message: "429 rate_limit", headline: "Claude usage limit reached." }),
    );
    b.ended(
      job("s:c1", "code", "api", {
        phase: "failed",
        line: "Something went wrong",
        startedAt: S0 - 5,
        endedAt: S0,
      }),
    );
    b.ended(
      job("s:c2", "chat", "Kleio", { phase: "done", line: "Done", startedAt: S0 - 5, endedAt: S0 }),
    );
    b.ended(
      job("s:c3", "code", "web", {
        phase: "stopped",
        line: "Stopped",
        startedAt: S0 - 900,
        endedAt: S0,
      }),
    );
    b.ended(
      job("g:g1", "group", "Launch", {
        phase: "done",
        line: "Done",
        detail: "Ada: Shipped the landing page.",
        startedAt: S0 - 900,
        endedAt: S0,
      }),
    );
    expect(b.brief([]).spoken).toBe(
      "Nothing needs you right now. Code in api failed. Claude usage limit reached. " +
        "The Launch group finished. Ada: Shipped the landing page.",
    );
  });

  it("only says what's new since the last briefing; asking again at once repeats it; all repeats the day", async () => {
    const b = make();
    b.ended(
      job("s:b1", "specialist", "Chef", {
        phase: "done",
        line: "Done",
        startedAt: S0 - 300,
        endedAt: S0,
      }),
    );
    clock += 60;
    expect(b.brief([]).items).toHaveLength(1);
    clock += 30; // a missed word: the same news again
    expect(b.brief([]).items).toHaveLength(1);
    clock += 900; // later: heard
    expect(b.brief([]).spoken).toMatch(/^All quiet\./);
    expect(b.brief([], { all: true }).items).toHaveLength(1);
    await b.flush();
  });

  it("remembers across a restart, and ignores a damaged file", async () => {
    const b = make();
    b.ended(
      job("s:b1", "specialist", "Chef", {
        phase: "done",
        line: "Done",
        startedAt: S0 - 300,
        endedAt: S0,
      }),
    );
    await b.flush();
    expect(JSON.parse(readFileSync(statePath(), "utf8")).outcomes).toHaveLength(1);
    const again = make();
    await again.load();
    expect(again.brief([]).items.map((i) => i.name)).toEqual(["Chef"]);
    await again.flush();

    writeFileSync(statePath(), "{not json");
    const fresh = make();
    await fresh.load();
    expect(fresh.brief([]).spoken).toMatch(/^All quiet\./);
    await fresh.flush();
  });
});

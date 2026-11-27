import { beforeEach, describe, expect, it } from "vitest";
import { SETUP_SEEN_KEY } from "../app-entry-view";
import {
  FINISHED_KEY,
  forgetSeen,
  markWelcomed,
  noteSteps,
  sightOf,
  STEPS_KEY,
  welcomeOwed,
  WELCOMED_KEY,
  type Sights,
} from "./overviewSeen";

type Store = Pick<Storage, "getItem" | "setItem">;

function store(seed: Record<string, string> = {}): Store & { data: Map<string, string> } {
  const data = new Map(Object.entries(seed));
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
  };
}
/** Reads, but every write throws: a full store. */
function fullStore(seed: Record<string, string> = {}): Store {
  const inner = store(seed);
  return {
    getItem: inner.getItem,
    setItem: () => {
      throw new DOMException("full", "QuotaExceededError");
    },
  };
}
/** Every read throws. */
const UNREADABLE: Store = {
  getItem: () => {
    throw new DOMException("denied", "SecurityError");
  },
  setItem: () => {
    throw new DOMException("denied", "SecurityError");
  },
};

/** Takes every write, and throws on every read. */
const WRITE_ONLY: Store = {
  getItem: () => {
    throw new DOMException("denied", "SecurityError");
  },
  setItem: () => undefined,
};

const sights = (
  host: Sights["host"],
  models: Sights["models"],
  voice: Sights["voice"],
  apps: Sights["apps"],
): Sights => ({
  host,
  models,
  voice,
  apps,
});
const ALL_DONE = sights("done", "done", "done", "done");
const record = (s: Store): unknown => JSON.parse(s.getItem(STEPS_KEY) ?? "null");

beforeEach(() => forgetSeen());

describe("welcomeOwed", () => {
  it("is owed on a new device", () => {
    expect(welcomeOwed(store())).toBe(true);
  });

  it("is not owed once Setup or Overview has been seen", () => {
    expect(welcomeOwed(store({ [SETUP_SEEN_KEY]: "1" }))).toBe(false);
  });

  it("is not owed once welcomed", () => {
    const s = store();
    markWelcomed(s);
    expect(s.data.get(WELCOMED_KEY)).toBe("1");
    expect(welcomeOwed(s)).toBe(false);
  });

  it("is not owed where the store can't be read, or there is none", () => {
    expect(welcomeOwed(UNREADABLE)).toBe(false);
    expect(welcomeOwed(null)).toBe(false);
  });

  it("is owed once a visit where the store won't write", () => {
    const s = fullStore();
    expect(welcomeOwed(s)).toBe(true);
    markWelcomed(s);
    expect(welcomeOwed(s)).toBe(false);
    // A restart forgets.
    forgetSeen();
    expect(welcomeOwed(s)).toBe(true);
  });
});

describe("sightOf", () => {
  it("sees a step that's fine as done, and one that's not set up as waiting", () => {
    expect(sightOf("voice", "ok", false)).toBe("done");
    expect(sightOf("voice", "unset", false)).toBe("todo");
  });

  it("sees nothing in a step that waits on the host, is being checked, couldn't be, or needs a look", () => {
    for (const mark of ["waiting", "checking", "unknown", "fault", "signin", "optional"])
      for (const step of ["models", "voice", "apps"] as const)
        expect(sightOf(step, mark, true)).toBeNull();
  });

  it("sees a host that isn't answering as waiting only on a new device's first visit", () => {
    expect(sightOf("host", "fault", true)).toBe("todo");
    expect(sightOf("host", "fault", false)).toBeNull();
    expect(sightOf("host", "checking", true)).toBeNull();
    expect(sightOf("host", "ok", true)).toBe("done");
  });
});

describe("noteSteps", () => {
  it("records a step first seen done, and says nothing", () => {
    const s = store();
    expect(noteSteps(s, sights("done", "done", null, null), false)).toEqual({
      said: [],
      finish: false,
    });
    expect(record(s)).toEqual({ host: "done", models: "done" });
  });

  it("records a step first seen not set up as waiting", () => {
    const s = store();
    expect(noteSteps(s, sights("done", "todo", "todo", "todo"), false).said).toEqual([]);
    expect(record(s)).toEqual({ host: "done", models: "todo", voice: "todo", apps: "todo" });
  });

  it("says a step once, when one seen waiting is seen done", () => {
    const s = store();
    noteSteps(s, sights("done", "todo", "todo", "todo"), false);
    expect(noteSteps(s, sights("done", "done", "todo", "todo"), false)).toEqual({
      said: ["models"],
      finish: false,
    });
    expect(record(s)).toEqual({ host: "done", models: "said", voice: "todo", apps: "todo" });
    expect(noteSteps(s, sights("done", "done", "todo", "todo"), false).said).toEqual([]);
  });

  it("says nothing again after a key is removed and added back", () => {
    const s = store();
    noteSteps(s, sights("done", "done", "todo", "done"), false);
    noteSteps(s, sights("done", "done", "done", "done"), false);
    expect(noteSteps(s, sights("done", "done", "todo", "todo"), false).said).toEqual([]);
    expect(noteSteps(s, ALL_DONE, false)).toEqual({ said: [], finish: false });
    expect(record(s)).toEqual({ host: "done", models: "done", voice: "said", apps: "done" });
  });

  it("says several at once in setup order", () => {
    const s = store({
      [STEPS_KEY]: JSON.stringify({ apps: "todo", voice: "todo", models: "todo", host: "todo" }),
    });
    expect(noteSteps(s, sights("done", "done", "done", "todo"), false).said).toEqual([
      "host",
      "models",
      "voice",
    ]);
  });

  it("writes nothing for a step it can't see, so a host back from offline plays nothing", () => {
    const s = store();
    // Offline at the first read: Voice and Apps wait on the host.
    noteSteps(s, sights(null, "done", null, null), false);
    expect(record(s)).toEqual({ models: "done" });
    expect(noteSteps(s, ALL_DONE, false)).toEqual({ said: [], finish: false });
    expect(record(s)).toEqual({ host: "done", models: "done", voice: "done", apps: "done" });
  });

  it("writes no record when there is nothing to record", () => {
    const s = store();
    noteSteps(s, sights(null, null, null, null), false);
    expect(s.data.has(STEPS_KEY)).toBe(false);
  });

  it("plays the host's line when a new device's host first answers", () => {
    const s = store();
    noteSteps(s, sights(sightOf("host", "fault", true), "todo", null, null), false);
    expect(record(s)).toEqual({ host: "todo", models: "todo" });
    expect(noteSteps(s, sights("done", "todo", "todo", "todo"), false).said).toEqual(["host"]);
  });

  it("lets the second of two windows find it already said", () => {
    const s = store({
      [STEPS_KEY]: JSON.stringify({ host: "done", models: "done", voice: "done", apps: "todo" }),
    });
    expect(noteSteps(s, ALL_DONE, false)).toEqual({ said: ["apps"], finish: true });
    expect(noteSteps(s, ALL_DONE, false)).toEqual({ said: [], finish: false });
  });
});

describe("the finish", () => {
  it("comes with the last step, once", () => {
    const s = store({
      [STEPS_KEY]: JSON.stringify({ host: "done", models: "said", voice: "said", apps: "todo" }),
    });
    expect(noteSteps(s, ALL_DONE, false)).toEqual({ said: ["apps"], finish: true });
    expect(s.data.get(FINISHED_KEY)).toBe("1");
    expect(noteSteps(s, ALL_DONE, false).finish).toBe(false);
  });

  it("is never shown to someone first seen all set up; the flag is set silently", () => {
    const s = store();
    expect(noteSteps(s, ALL_DONE, false)).toEqual({ said: [], finish: false });
    expect(s.data.get(FINISHED_KEY)).toBe("1");
  });

  it("needs every step done", () => {
    const s = store({
      [STEPS_KEY]: JSON.stringify({ host: "done", models: "todo", voice: "todo", apps: "todo" }),
    });
    expect(noteSteps(s, sights("done", "done", "done", "todo"), false).finish).toBe(false);
    expect(noteSteps(s, sights(null, "done", "done", "done"), false).finish).toBe(false);
    expect(s.data.has(FINISHED_KEY)).toBe(false);
  });

  it("waits, unspent, while something needs a look", () => {
    const s = store({
      [STEPS_KEY]: JSON.stringify({ host: "done", models: "done", voice: "done", apps: "todo" }),
    });
    expect(noteSteps(s, ALL_DONE, true)).toEqual({ said: ["apps"], finish: false });
    expect(s.data.has(FINISHED_KEY)).toBe(false);
    expect(noteSteps(s, ALL_DONE, true).finish).toBe(false);
    expect(noteSteps(s, ALL_DONE, false)).toEqual({ said: [], finish: true });
    expect(s.data.get(FINISHED_KEY)).toBe("1");
  });

  it("is not shown again once the flag is set", () => {
    const s = store({
      [FINISHED_KEY]: "1",
      [STEPS_KEY]: JSON.stringify({ host: "done", models: "said", voice: "done", apps: "done" }),
    });
    expect(noteSteps(s, ALL_DONE, false).finish).toBe(false);
  });
});

describe("a record that can't be trusted", () => {
  it.each(["{not json", "null", "[]", '"done"', "7"])("reads %s as empty", (raw) => {
    const s = store({ [STEPS_KEY]: raw });
    expect(noteSteps(s, sights("done", "todo", null, null), false).said).toEqual([]);
    expect(record(s)).toEqual({ host: "done", models: "todo" });
  });

  it("ignores names and values it doesn't know", () => {
    const s = store({
      [STEPS_KEY]: JSON.stringify({ models: "todo", voice: "yes", brain: "todo", apps: 1 }),
    });
    expect(noteSteps(s, sights("done", "done", "done", "todo"), false).said).toEqual(["models"]);
    expect(record(s)).toEqual({ host: "done", models: "said", voice: "done", apps: "todo" });
  });
});

describe("where nothing can be stored", () => {
  it.each([
    ["can't be read", UNREADABLE],
    ["takes writes it can't read back", WRITE_ONLY],
    ["won't write", fullStore()],
    ["is absent", null],
  ])("keeps the record in memory when the store %s: each moment once a visit", (_name, s) => {
    expect(noteSteps(s, sights("done", "done", "done", "todo"), false).said).toEqual([]);
    expect(noteSteps(s, ALL_DONE, false)).toEqual({ said: ["apps"], finish: true });
    expect(noteSteps(s, ALL_DONE, false)).toEqual({ said: [], finish: false });
  });

  it("forgets on a restart", () => {
    noteSteps(UNREADABLE, sights("done", "done", "done", "todo"), false);
    forgetSeen();
    expect(noteSteps(UNREADABLE, ALL_DONE, false)).toEqual({ said: [], finish: false });
  });
});

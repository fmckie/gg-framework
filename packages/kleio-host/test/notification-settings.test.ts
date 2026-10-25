import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ApnsPusher, LiveActivityPush, Nudge } from "../src/apns.js";
import {
  createNotificationSettings,
  parseNotificationSettings,
  textlessPusher,
  unquotedLivePush,
  unquotedNudge,
} from "../src/notification-settings.js";

let dir: string;
let path: string;
let logs: string[];
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "kleio-notifications-"));
  path = join(dir, "notifications.json");
  logs = [];
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const store = (): ReturnType<typeof createNotificationSettings> =>
  createNotificationSettings({ path, log: (m) => logs.push(m) });

/** A question on the lock screen, as live-activity.ts sends it. */
const QUESTION: LiveActivityPush = {
  event: "start",
  attributesType: "KleioActivityAttributes",
  attributes: { kind: "code", title: "my-app", sessionId: "s1" },
  contentState: {
    phase: "needsYou",
    line: "Needs your help",
    detail: "Ship the release to everyone?",
    startedAt: 1_792_000_000,
    step: 3,
    prevLine: "Edited host.ts",
    askId: "ask-3",
    askKey: "0123456789abcdef0123456789abcdef",
    options: ["Ship it", "Wait"],
    recommended: 0,
  },
  alert: { title: "my-app", body: "Ship the release to everyone?", sound: "default" },
  staleDate: 1_792_001_800,
  priority: 10,
};

describe("the setting", () => {
  it("quotes by default, before any admin has chosen", async () => {
    expect(await store().current()).toEqual({ quoteText: true });
  });

  it("keeps what an admin sets, in a file only this user reads", async () => {
    const s = store();
    expect(await s.set({ quoteText: false })).toEqual({ quoteText: false });
    expect(await s.current()).toEqual({ quoteText: false });
    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual({ quoteText: false });
    // Windows keeps no POSIX mode (a file reads as 0666): there the file has its
    // folder's access, and it holds no secret.
    if (process.platform !== "win32") {
      expect(statSync(path).mode & 0o777).toBe(0o600);
    }
    // Another host process reads the same file.
    expect(await store().current()).toEqual({ quoteText: false });
    await s.set({ quoteText: true });
    expect(await store().current()).toEqual({ quoteText: true });
  });

  it("quotes nothing when the file can't be read, and says so once", async () => {
    for (const text of ["{not json", '{"quoteText":"yes"}', "[]", '{"quoteText":true,"x":1}']) {
      writeFileSync(path, text);
      const s = store();
      expect(await s.current()).toEqual({ quoteText: false });
      expect(await s.current()).toEqual({ quoteText: false });
    }
    expect(logs).toHaveLength(4);
    expect(logs[0]).toContain("notifications quote nothing");
  });

  it("takes exactly {quoteText: boolean}", () => {
    expect(parseNotificationSettings({ quoteText: false })).toEqual({ quoteText: false });
    expect(parseNotificationSettings({ quoteText: true })).toEqual({ quoteText: true });
    for (const bad of [null, [], "off", { quoteText: 0 }, {}, { quoteText: true, more: 1 }]) {
      expect(parseNotificationSettings(bad)).toBeNull();
    }
  });
});

describe("leaving the text out", () => {
  it("drops a notification's quote, and keeps whose it is and what happened", () => {
    const nudge: Nudge = {
      sessionId: "s1",
      kind: "finished",
      name: "Research heat pumps",
      text: "Air-source suits a flat.",
    };
    expect(unquotedNudge(nudge)).toEqual({
      sessionId: "s1",
      kind: "finished",
      name: "Research heat pumps",
    });
    const group: Nudge = { groupId: "g1", kind: "message", author: "Sam", text: "Done." };
    expect(unquotedNudge(group)).toEqual({ groupId: "g1", kind: "message", author: "Sam" });
  });

  it("drops a Live Activity's question, result and answer buttons, and keeps its steps", () => {
    expect(unquotedLivePush(QUESTION)).toEqual({
      ...QUESTION,
      contentState: {
        phase: "needsYou",
        line: "Needs your help",
        startedAt: 1_792_000_000,
        step: 3,
        prevLine: "Edited host.ts",
      },
      alert: { title: "my-app", body: "Tap to answer.", sound: "default" },
    });
    const done: LiveActivityPush = {
      event: "end",
      contentState: { phase: "done", line: "Done", summary: "Air-source suits a flat." },
      priority: 10,
    };
    expect(unquotedLivePush(done)).toEqual({
      event: "end",
      contentState: { phase: "done", line: "Done" },
      priority: 10,
    });
  });
});

describe("textlessPusher", () => {
  function recorder(): { pusher: ApnsPusher; nudges: Nudge[]; pushes: LiveActivityPush[] } {
    const nudges: Nudge[] = [];
    const pushes: LiveActivityPush[] = [];
    const pusher: ApnsPusher = {
      configured: true,
      env: "sandbox",
      async notify(nudge) {
        nudges.push(nudge);
        return 1;
      },
      async pairing() {
        return 1;
      },
      async liveActivity(_target, push) {
        pushes.push(push);
        return "ok";
      },
    };
    return { pusher, nudges, pushes };
  }
  const NUDGE: Nudge = { sessionId: "s1", kind: "question", text: "Ship it?" };
  const TARGET = { token: "cd".repeat(32), env: "sandbox" as const };

  it("passes everything on as it is while quoting is on", async () => {
    const r = recorder();
    const p = textlessPusher(r.pusher, store());
    expect([p.configured, p.env]).toEqual([true, "sandbox"]);
    await p.notify(NUDGE, []);
    await p.liveActivity(TARGET, QUESTION);
    expect(r.nudges).toEqual([NUDGE]);
    expect(r.pushes).toEqual([QUESTION]);
  });

  it("leaves the text out of each push once an admin turns quoting off", async () => {
    const r = recorder();
    const s = store();
    const p = textlessPusher(r.pusher, s);
    await s.set({ quoteText: false });
    await p.notify(NUDGE, []);
    await p.liveActivity(TARGET, QUESTION);
    expect(r.nudges).toEqual([{ sessionId: "s1", kind: "question" }]);
    expect(r.pushes).toEqual([unquotedLivePush(QUESTION)]);
    // On again: quotes from the next push.
    await s.set({ quoteText: true });
    await p.notify(NUDGE, []);
    expect(r.nudges[1]).toEqual(NUDGE);
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import * as api from "./kleioApi";
import {
  describeAutoSchedules,
  describeSchedule,
  formatWhen,
  nextRun,
  systemTimezone,
} from "./blobFormat";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
const invokeMock = vi.mocked(invoke);

/** Reply to the next kleio_api call with `status`/`body`; returns the call log. */
function reply(body: unknown, status = 200): Array<Record<string, unknown>> {
  const calls: Array<Record<string, unknown>> = [];
  invokeMock.mockImplementation(async (cmd, args) => {
    expect(cmd).toBe("kleio_api");
    calls.push(args as Record<string, unknown>);
    return { status, body };
  });
  return calls;
}

const SCHEDULE: api.Schedule = {
  id: "s_00000001",
  label: "Morning brief",
  prompt: "Summarise my day",
  kind: "daily",
  time: "08:00",
  timezone: "Europe/London",
  enabled: true,
  notify: true,
  nextRunAt: "2026-10-01T07:00:00.000Z",
  source: "auto",
};

const BLOB: api.Blob = {
  id: "b_0000000a",
  name: "Chef",
  emoji: "🍳",
  color: "peach",
  job: "Plan dinners every evening",
  model: null,
  createdAt: "2026-09-30T10:00:00.000Z",
  updatedAt: "2026-09-30T10:00:00.000Z",
  schedules: [SCHEDULE],
  running: false,
};

beforeEach(() => {
  invokeMock.mockReset();
});

describe("kleioApi transport", () => {
  it("sends method/path/body/session and unwraps 2xx bodies", async () => {
    const calls = reply({ sessionId: "sess-1", sessionPath: null, created: false });
    await expect(api.getHome()).resolves.toMatchObject({ sessionId: "sess-1" });
    expect(calls[0]).toEqual({ method: "GET", path: "/kleio/home", body: null, session: null });
  });

  it("throws KleioApiError with the host's error, status and detail", async () => {
    reply({ error: "model unavailable", detail: "no such model" }, 502);
    const err = await api.getBlobSession("b_0000000a").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(api.KleioApiError);
    expect(err).toMatchObject({
      status: 502,
      message: "model unavailable",
      detail: "no such model",
    });
  });

  it("falls back to a generic message and maps a transport failure to status 0", async () => {
    reply(null, 500);
    await expect(api.listBlobs()).rejects.toMatchObject({ status: 500, message: /HTTP 500/ });
    invokeMock.mockRejectedValueOnce("kleio_api: not connected to a Kleio host");
    await expect(api.listBlobs()).rejects.toMatchObject({ status: 0, message: /not connected/ });
  });
});

describe("kleioApi routes", () => {
  const cases: Array<{
    name: string;
    run: () => Promise<unknown>;
    body: unknown;
    expectCall: Record<string, unknown>;
    result?: unknown;
  }> = [
    {
      name: "newHome",
      run: () => api.newHome(),
      body: { sessionId: "s2", sessionPath: null, created: true },
      expectCall: { method: "POST", path: "/kleio/home/new" },
    },
    {
      name: "listBlobs",
      run: () => api.listBlobs(),
      body: { blobs: [BLOB] },
      expectCall: { method: "GET", path: "/kleio/blobs" },
      result: [BLOB],
    },
    {
      name: "getBlob",
      run: () => api.getBlob("b_0000000a"),
      body: { blob: BLOB },
      expectCall: { method: "GET", path: "/kleio/blobs/b_0000000a" },
      result: BLOB,
    },
    {
      name: "createBlob",
      run: () =>
        api.createBlob({
          name: "Chef",
          job: "Plan dinners",
          emoji: "🍳",
          timezone: "Europe/Paris",
        }),
      body: { blob: BLOB, autoSchedules: { status: "ok", count: 1 } },
      expectCall: {
        method: "POST",
        path: "/kleio/blobs",
        body: { name: "Chef", job: "Plan dinners", emoji: "🍳", timezone: "Europe/Paris" },
      },
      result: { blob: BLOB, autoSchedules: { status: "ok", count: 1 } },
    },
    {
      name: "updateBlob",
      run: () => api.updateBlob("b_0000000a", { color: "mint" }),
      body: { blob: BLOB },
      expectCall: { method: "PATCH", path: "/kleio/blobs/b_0000000a", body: { color: "mint" } },
      result: { blob: BLOB },
    },
    {
      name: "deleteBlob",
      run: () => api.deleteBlob("b_0000000a"),
      body: { ok: true },
      expectCall: { method: "DELETE", path: "/kleio/blobs/b_0000000a" },
      result: undefined,
    },
    {
      name: "getBlobSession",
      run: () => api.getBlobSession("b_0000000a"),
      body: { sessionId: "s3", sessionPath: null, created: false },
      expectCall: { method: "GET", path: "/kleio/blobs/b_0000000a/session" },
    },
    {
      name: "newBlobSession",
      run: () => api.newBlobSession("b_0000000a"),
      body: { sessionId: "s4", sessionPath: null, created: true },
      expectCall: { method: "POST", path: "/kleio/blobs/b_0000000a/new" },
    },
    {
      name: "listRuns",
      run: () => api.listRuns("b_0000000a"),
      body: { runs: [] },
      expectCall: { method: "GET", path: "/kleio/blobs/b_0000000a/runs" },
      result: [],
    },
    {
      name: "addSchedule",
      run: () =>
        api.addSchedule("b_0000000a", {
          label: "Brief",
          prompt: "Go",
          kind: "interval",
          everyMinutes: 120,
        }),
      body: { schedule: SCHEDULE },
      expectCall: {
        method: "POST",
        path: "/kleio/blobs/b_0000000a/schedules",
        body: { label: "Brief", prompt: "Go", kind: "interval", everyMinutes: 120 },
      },
      result: SCHEDULE,
    },
    {
      name: "updateSchedule",
      run: () => api.updateSchedule("b_0000000a", "s_00000001", { enabled: false }),
      body: { schedule: SCHEDULE },
      expectCall: {
        method: "PATCH",
        path: "/kleio/blobs/b_0000000a/schedules/s_00000001",
        body: { enabled: false },
      },
      result: SCHEDULE,
    },
    {
      name: "deleteSchedule",
      run: () => api.deleteSchedule("b_0000000a", "s_00000001"),
      body: { ok: true },
      expectCall: { method: "DELETE", path: "/kleio/blobs/b_0000000a/schedules/s_00000001" },
      result: undefined,
    },
    {
      name: "runScheduleNow",
      run: () => api.runScheduleNow("b_0000000a", "s_00000001"),
      body: { run: { id: "r1" } },
      expectCall: { method: "POST", path: "/kleio/blobs/b_0000000a/schedules/s_00000001/run" },
      result: { id: "r1" },
    },
    {
      name: "suggestSchedules",
      run: () => api.suggestSchedules({ job: "every morning", timezone: "UTC" }),
      body: { schedules: [{ label: "x", prompt: "y", kind: "daily", time: "08:00" }] },
      expectCall: {
        method: "POST",
        path: "/kleio/blobs/suggest-schedules",
        body: { job: "every morning", timezone: "UTC" },
      },
      result: [{ label: "x", prompt: "y", kind: "daily", time: "08:00" }],
    },
    {
      name: "listModels",
      run: () => api.listModels(),
      body: { models: [{ id: "local/x", label: "X", private: true }], defaultBlobModel: "local/x" },
      expectCall: { method: "GET", path: "/kleio/models" },
    },
    {
      name: "listGroups",
      run: () => api.listGroups(),
      body: { groups: [] },
      expectCall: { method: "GET", path: "/kleio/groups" },
      result: [],
    },
    {
      name: "createGroup",
      run: () => api.createGroup({ name: "Team", members: ["b_0000000a"] }),
      body: { group: { id: "g_00000001" } },
      expectCall: {
        method: "POST",
        path: "/kleio/groups",
        body: { name: "Team", members: ["b_0000000a"] },
      },
      result: { id: "g_00000001" },
    },
    {
      name: "updateGroup",
      run: () => api.updateGroup("g_00000001", { name: "Crew" }),
      body: { group: { id: "g_00000001" } },
      expectCall: { method: "PATCH", path: "/kleio/groups/g_00000001", body: { name: "Crew" } },
      result: { id: "g_00000001" },
    },
    {
      name: "deleteGroup",
      run: () => api.deleteGroup("g_00000001"),
      body: { ok: true },
      expectCall: { method: "DELETE", path: "/kleio/groups/g_00000001" },
      result: undefined,
    },
    {
      name: "listGroupMessages (paged)",
      run: () => api.listGroupMessages("g_00000001", { after: 12, limit: 50 }),
      body: { messages: [], typing: [], lastSeq: 12 },
      expectCall: { method: "GET", path: "/kleio/groups/g_00000001/messages?after=12&limit=50" },
    },
    {
      name: "listGroupMessages (first page)",
      run: () => api.listGroupMessages("g_00000001"),
      body: { messages: [], typing: [], lastSeq: 0 },
      expectCall: { method: "GET", path: "/kleio/groups/g_00000001/messages" },
    },
    {
      name: "sendGroupMessage",
      run: () => api.sendGroupMessage("g_00000001", "hi @Chef"),
      body: { message: { seq: 1 } },
      expectCall: {
        method: "POST",
        path: "/kleio/groups/g_00000001/messages",
        body: { text: "hi @Chef" },
      },
      result: { seq: 1 },
    },
    {
      name: "listConnections",
      run: () => api.listConnections(),
      body: { configured: false, connections: [] },
      expectCall: { method: "GET", path: "/kleio/connections" },
    },
    {
      name: "listToolkits (search + cursor, strictly encoded)",
      run: () => api.listToolkits({ search: "g mail (beta)*", cursor: "c/2" }),
      body: { toolkits: [], nextCursor: null },
      expectCall: {
        method: "GET",
        path: "/kleio/connections/toolkits?search=g%20mail%20%28beta%29%2A&cursor=c%2F2",
      },
    },
    {
      name: "connectToolkit",
      run: () => api.connectToolkit("gmail"),
      body: { redirectUrl: "https://x", connectionId: "c1" },
      expectCall: { method: "POST", path: "/kleio/connections", body: { toolkit: "gmail" } },
    },
    {
      name: "disconnect",
      run: () => api.disconnect("ca_1"),
      body: { ok: true },
      expectCall: { method: "DELETE", path: "/kleio/connections/ca_1" },
      result: undefined,
    },
  ];

  for (const c of cases) {
    it(c.name, async () => {
      const calls = reply(c.body);
      const out = await c.run();
      expect(calls).toHaveLength(1);
      expect(calls[0]).toMatchObject({ body: null, session: null, ...c.expectCall });
      expect(out).toEqual("result" in c ? c.result : c.body);
    });
  }

  it("session-scoped thread calls carry the session id", async () => {
    const calls = reply({ history: [{ role: "user", text: "hi" }] });
    await expect(api.threadHistory("sess-9")).resolves.toEqual([{ role: "user", text: "hi" }]);
    reply({});
    await expect(api.threadHistory("sess-9")).resolves.toEqual([]);
    const p = reply({ ok: true });
    await api.threadPrompt("sess-9", "hello");
    await api.threadCancel("sess-9");
    const s = reply({ running: true });
    await expect(api.threadState("sess-9")).resolves.toEqual({ running: true });
    await api.threadMemories("sess-9");
    expect(calls[0]).toEqual({ method: "GET", path: "/history", body: null, session: "sess-9" });
    expect(p[0]).toEqual({
      method: "POST",
      path: "/prompt",
      body: { text: "hello", attachments: [] },
      session: "sess-9",
    });
    expect(p[1]).toMatchObject({ method: "POST", path: "/cancel", session: "sess-9" });
    expect(s.map((c) => c.path)).toEqual(["/state", "/memories"]);
  });
});

describe("blobFormat", () => {
  const base = { timezone: "Europe/London" };
  it("describes every schedule kind like the phone", () => {
    expect(describeSchedule({ ...base, kind: "daily", time: "08:00" })).toBe("Every day at 08:00");
    expect(describeSchedule({ ...base, kind: "weekly", time: "18:30", days: [5, 1, 3] })).toBe(
      "Mon, Wed, Fri at 18:30",
    );
    expect(describeSchedule({ ...base, kind: "weekly", time: "09:00", days: [0, 1] })).toBe(
      "Mon, Sun at 09:00",
    );
    expect(
      describeSchedule({ ...base, kind: "weekly", time: "07:00", days: [1, 2, 3, 4, 5] }),
    ).toBe("Weekdays at 07:00");
    expect(describeSchedule({ ...base, kind: "interval", everyMinutes: 120 })).toBe(
      "Every 2 hours",
    );
    expect(describeSchedule({ ...base, kind: "interval", everyMinutes: 60 })).toBe("Every hour");
    expect(describeSchedule({ ...base, kind: "interval", everyMinutes: 45 })).toBe(
      "Every 45 minutes",
    );
    expect(describeSchedule({ ...base, kind: "once", at: "2026-10-03T08:00:00.000Z" })).toBe(
      "Once on 3 Oct at 09:00",
    );
    expect(describeSchedule({ ...base, kind: "once" })).toBe("Once");
  });

  it("formats relative times and picks the next enabled run", () => {
    const now = new Date(2026, 8, 30, 10, 0);
    expect(formatWhen(new Date(2026, 8, 30, 18, 5).toISOString(), now)).toBe("today 18:05");
    expect(formatWhen(new Date(2026, 9, 1, 8, 0).toISOString(), now)).toBe("tomorrow 08:00");
    expect(formatWhen(new Date(2026, 9, 3, 9, 0).toISOString(), now)).toBe("Sat 3 Oct 09:00");
    expect(formatWhen("nope", now)).toBe("");
    const later = { ...SCHEDULE, id: "s2", nextRunAt: "2026-10-02T07:00:00.000Z" };
    const off = { ...SCHEDULE, id: "s3", enabled: false, nextRunAt: "2026-09-30T11:00:00.000Z" };
    expect(nextRun([later, SCHEDULE, off])).toBe(SCHEDULE.nextRunAt);
    expect(nextRun([off])).toBeNull();
  });

  it("words the auto-schedule result and tolerates an older host", () => {
    expect(describeAutoSchedules(undefined)).toBeNull();
    expect(describeAutoSchedules({ status: "ok", count: 2 })).toMatch(/Added 2 schedules/);
    expect(describeAutoSchedules({ status: "ok", count: 1 })).toMatch(/Added 1 schedule\b/);
    expect(describeAutoSchedules({ status: "none", count: 0 })).toMatch(/No timing/);
    expect(describeAutoSchedules({ status: "failed", count: 0, error: "timeout" })).toMatch(
      /timeout/,
    );
    // A zone the host can schedule in: "Europe/London" here, plain "UTC" on
    // CI machines.
    const zone = systemTimezone();
    expect(zone).toMatch(/^(?:UTC|[A-Za-z_]+(?:\/[A-Za-z0-9_+-]+)+)$/);
    expect(() => new Intl.DateTimeFormat("en-GB", { timeZone: zone })).not.toThrow();
  });

  it.each(["Etc/Unknown", "", "Not/AZone"])(
    "never schedules in a zone the host would refuse (%j)",
    (reported) => {
      const real = Intl.DateTimeFormat.prototype.resolvedOptions;
      const spy = vi
        .spyOn(Intl.DateTimeFormat.prototype, "resolvedOptions")
        .mockImplementation(function (this: Intl.DateTimeFormat) {
          return { ...real.call(this), timeZone: reported };
        });
      try {
        expect(systemTimezone()).toBe("Europe/London");
      } finally {
        spy.mockRestore();
      }
    },
  );
});

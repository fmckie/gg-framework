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

describe("getBrief", () => {
  it("asks the host for what's new, or the last day's news", async () => {
    const brief = { spoken: "All quiet.", items: [], since: 1, at: 2 };
    const calls = reply(brief);
    expect(await api.getBrief()).toEqual(brief);
    await api.getBrief(true);
    expect(calls).toEqual([
      { method: "POST", path: "/kleio/brief", body: {}, session: null },
      { method: "POST", path: "/kleio/brief", body: { all: true }, session: null },
    ]);
  });
});

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

describe("shows", () => {
  const ID = "sh_0123456789abcdef0123456789abcdef";

  it("makes a file show and a page show, as the host's routes take them", async () => {
    const file = reply({ show: { id: ID, kind: "text", name: "plan.md", state: "ready" } });
    expect(
      await api.createFileShow({ source: "project", id: "app", path: ".gg/plans/plan.md" }),
    ).toEqual({ id: ID, kind: "text", name: "plan.md", state: "ready", format: "plain" });
    const page = { id: ID, kind: "web", name: "bbc.co.uk", host: "bbc.co.uk", state: "capturing" };
    const link = reply({ show: page });
    expect(await api.createLinkShow("https://bbc.co.uk/news", "phone")).toEqual(page);
    const asked = reply({ show: { ...page, state: "ready", signIn: true, cut: true } });
    expect(await api.getShow(ID)).toMatchObject({ state: "ready", signIn: true, cut: true });
    expect([...file, ...link, ...asked]).toEqual([
      {
        method: "POST",
        path: "/kleio/voice/show",
        body: { source: "project", id: "app", path: ".gg/plans/plan.md" },
        session: null,
      },
      {
        method: "POST",
        path: "/kleio/voice/show",
        body: { url: "https://bbc.co.uk/news", view: "phone" },
        session: null,
      },
      {
        method: "GET",
        path: `/kleio/voice/show/${ID}`,
        body: null,
        session: null,
        timeoutMs: 15_000,
      },
    ]);
  });

  it("asks after a show only by an id the host could have made", async () => {
    for (const bad of ["", "sh_123", "../devices", `${ID}/image`, `${ID}?x=1`]) {
      await expect(api.getShow(bad)).rejects.toMatchObject({ status: 0, message: "bad_request" });
    }
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("keeps what it knows from the host's show and refuses one it can't read", () => {
    const pdf = {
      id: ID,
      kind: "pdf",
      name: "report.pdf",
      state: "ready",
      pages: 100,
      totalPages: 340,
      title: "  Annual report  ",
      extra: "dropped",
    };
    expect(api.parseShowInfo(pdf)).toEqual({
      id: ID,
      kind: "pdf",
      name: "report.pdf",
      state: "ready",
      pages: 100,
      totalPages: 340,
      title: "Annual report",
    });
    // A page count drives how many pages are asked for: never a guess.
    for (const bad of [
      { ...pdf, pages: 0 },
      { ...pdf, pages: 501 },
      { ...pdf, pages: 2.5 },
      { ...pdf, pages: "12" },
      { ...pdf, id: "sh_nothex" },
      { ...pdf, kind: "html" },
      { ...pdf, state: "done" },
      { ...pdf, name: "   " },
      null,
      [],
      "show",
    ]) {
      expect(api.parseShowInfo(bad), JSON.stringify(bad)).toBeNull();
    }
    // A total under what's shown is the count shown; reasons are words, details clipped.
    expect(api.parseShowInfo({ ...pdf, totalPages: 3 })).toMatchObject({
      pages: 100,
      totalPages: 100,
    });
    const failed = api.parseShowInfo({
      id: ID,
      kind: "web",
      name: "example.com",
      state: "failed",
      reason: "<b>x</b>",
      detail: "x".repeat(900),
    });
    expect(failed).not.toHaveProperty("reason");
    expect(failed?.detail).toHaveLength(500);
  });

  it("calls an answer that isn't a show an error, never a show", async () => {
    reply({ show: { id: ID, kind: "web", state: "ready" } });
    await expect(api.getShow(ID)).rejects.toMatchObject({ status: 502, message: "bad_answer" });
    reply(
      { error: "refused", detail: "That page is on a private network, so it can't be shown." },
      422,
    );
    await expect(api.createLinkShow("http://10.0.0.1/", "desktop")).rejects.toMatchObject({
      status: 422,
      message: "refused",
      detail: "That page is on a private network, so it can't be shown.",
    });
  });

  it("fetches a part as bytes, and passes on the host's reason when it can't", async () => {
    invokeMock.mockResolvedValueOnce(new Uint8Array([0x89, 0x50, 0x4e, 0x47]).buffer);
    expect([...(await api.getShowPart(ID, "page-3"))]).toEqual([0x89, 0x50, 0x4e, 0x47]);
    expect(invokeMock).toHaveBeenLastCalledWith("kleio_show_part", { id: ID, part: "page-3" });
    // Tauri's fallback channel hands back numbers.
    invokeMock.mockResolvedValueOnce([104, 105]);
    expect(new TextDecoder().decode(await api.getShowPart(ID, "text"))).toBe("hi");
    invokeMock.mockResolvedValueOnce([300]);
    await expect(api.getShowPart(ID, "text")).rejects.toMatchObject({ status: 502 });
    invokeMock.mockRejectedValueOnce({
      status: 409,
      error: "changed",
      detail: "That file has changed since Kleio showed it.",
    });
    await expect(api.getShowPart(ID, "text")).rejects.toMatchObject({
      status: 409,
      message: "changed",
      detail: "That file has changed since Kleio showed it.",
    });
    invokeMock.mockRejectedValueOnce("IPC failed");
    await expect(api.getShowPart(ID, "image")).rejects.toMatchObject({
      status: 0,
      message: "IPC failed",
    });
  });
});

describe("dictation setup", () => {
  const BYTES = 138_853_314;

  it("asks the host where its speech model is, and starts the download, with a 10 s limit", async () => {
    const calls = reply({ dictation: { state: "absent", bytes: BYTES } });
    expect(await api.getDictationSetup()).toEqual({ state: "absent", bytes: BYTES });
    const started = reply({ dictation: { state: "downloading", loaded: 0, bytes: BYTES } });
    expect(await api.startDictationSetup()).toEqual({
      state: "downloading",
      loaded: 0,
      bytes: BYTES,
    });
    expect([...calls, ...started]).toEqual([
      {
        method: "GET",
        path: "/kleio/setup/dictation",
        body: null,
        session: null,
        timeoutMs: 10_000,
      },
      {
        method: "POST",
        path: "/kleio/setup/dictation",
        body: null,
        session: null,
        timeoutMs: 10_000,
      },
    ]);
  });

  it("throws the host's status, so the card can tell an old host from a down engine", async () => {
    reply({ error: "not_found" }, 404);
    await expect(api.getDictationSetup()).rejects.toMatchObject({ status: 404 });
    reply({ error: "engine_unavailable" }, 503);
    await expect(api.startDictationSetup()).rejects.toMatchObject({
      status: 503,
      message: "engine_unavailable",
    });
  });

  it("refuses an answer it can't read rather than guessing", async () => {
    reply({ dictation: { state: "paused", bytes: BYTES } });
    await expect(api.getDictationSetup()).rejects.toBeInstanceOf(api.KleioApiError);
    reply({});
    await expect(api.getDictationSetup()).rejects.toMatchObject({ status: 502 });
  });

  it.each([
    [
      { state: "absent", bytes: 5 },
      { state: "absent", bytes: 5 },
    ],
    [
      { state: "loading", bytes: 5 },
      { state: "loading", bytes: 5 },
    ],
    [
      { state: "ready", bytes: 5, extra: "dropped" },
      { state: "ready", bytes: 5 },
    ],
    [
      { state: "downloading", loaded: 2, bytes: 5 },
      { state: "downloading", loaded: 2, bytes: 5 },
    ],
    [
      { state: "failed", reason: "storage", bytes: 5, detail: "ENOSPC" },
      { state: "failed", reason: "storage", bytes: 5 },
    ],
    [
      { state: "unsupported", os: "darwin", arch: "x64", bytes: 5 },
      { state: "unsupported", os: "darwin", arch: "x64", bytes: 5 },
    ],
  ])("parseDictationStatus reads %j", (raw, parsed) => {
    expect(api.parseDictationStatus(raw)).toEqual(parsed);
  });

  it.each([
    null,
    "ready",
    [],
    { state: "ready" },
    { state: "ready", bytes: -1 },
    { state: "ready", bytes: 1.5 },
    { state: "ready", bytes: "5" },
    { state: "downloading", bytes: 5 },
    { state: "downloading", loaded: 6, bytes: 5 },
    { state: "failed", bytes: 5 },
    { state: "failed", reason: "ENOSPC: no space left", bytes: 5 },
    { state: "failed", reason: "toString", bytes: 5 },
    { state: "unsupported", os: "darwin", bytes: 5 },
    { state: "unsupported", os: "../../etc", arch: "x64", bytes: 5 },
    { state: "paused", bytes: 5 },
  ])("parseDictationStatus refuses %j", (raw) => {
    expect(api.parseDictationStatus(raw)).toBeNull();
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
      // An older host: no activity or outcomes at all.
      name: "listGroupMessages (first page)",
      run: () => api.listGroupMessages("g_00000001"),
      body: { messages: [], typing: [], lastSeq: 0 },
      expectCall: { method: "GET", path: "/kleio/groups/g_00000001/messages" },
    },
    {
      name: "listGroupMessages (member activity and outcomes)",
      run: () => api.listGroupMessages("g_00000001"),
      body: {
        messages: [],
        typing: ["b_0000000a"],
        lastSeq: 3,
        activity: {
          b_0000000a: [
            {
              id: "t1",
              name: "bash",
              summary: "pnpm test",
              status: "failed",
              startedAt: "2026-10-05T09:00:00.000Z",
              endedAt: "2026-10-05T09:00:04.000Z",
            },
            {
              id: "t2",
              name: "read",
              summary: "src/App.tsx",
              status: "running",
              startedAt: "2026-10-05T09:00:05.000Z",
            },
          ],
        },
        outcomes: { b_0000000b: { kind: "timed_out", reason: "took over 2 min" } },
      } satisfies api.GroupMessagesPage,
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

import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { request as httpRequest } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ApnsPusher } from "../src/apns.js";
import { nextOccurrence } from "../src/blob-schedule.js";
import { DEFAULT_BLOB_MODEL } from "../src/blobs.js";
import { createDeviceRegistry, type DeviceRegistry } from "../src/device-registry.js";
import { createFileKeychain, generateMasterKey } from "../src/file-keychain.js";
import { createHost, DEVICE_TOKEN_HEADER, type Host } from "../src/host.js";
import { createPairOfferStore } from "../src/pair-offer.js";
import { createRingStore } from "../src/sse-ring.js";
import { fakeSidecar, type FakeSidecar } from "./fake-sidecar.js";

// ---------------------------------------------------------------- schedule math

describe("blob schedules: nextRunAt", () => {
  const LONDON = "Europe/London";
  const at = (iso: string): number => Date.parse(iso);
  const iso = (t: number | null): string | null => (t === null ? null : new Date(t).toISOString());

  it("interval: created + N, then every N on the same grid, skipping missed boundaries", () => {
    const s = { kind: "interval", everyMinutes: 15, timezone: LONDON } as const;
    expect(iso(nextOccurrence(s, at("2026-01-01T10:00:00Z")))).toBe("2026-01-01T10:15:00.000Z");
    // Fired on time.
    expect(iso(nextOccurrence(s, at("2026-01-01T10:15:02Z"), at("2026-01-01T10:15:00Z")))).toBe(
      "2026-01-01T10:30:00.000Z",
    );
    // An hour late: the three missed boundaries are skipped, the grid kept.
    expect(iso(nextOccurrence(s, at("2026-01-01T11:20:00Z"), at("2026-01-01T10:15:00Z")))).toBe(
      "2026-01-01T11:30:00.000Z",
    );
  });

  it("daily: the next wall-clock HH:MM in the zone, across the October DST change", () => {
    const s = { kind: "daily", time: "09:00", timezone: LONDON } as const;
    // Saturday 24 Oct 2026 is BST (UTC+1): 09:00 local = 08:00Z.
    expect(iso(nextOccurrence(s, at("2026-10-24T07:00:00Z")))).toBe("2026-10-24T08:00:00.000Z");
    // Sunday 25 Oct (last Sunday of October) is GMT: 09:00 local = 09:00Z.
    expect(iso(nextOccurrence(s, at("2026-10-24T08:00:00Z")))).toBe("2026-10-25T09:00:00.000Z");
    // And back again in March.
    expect(iso(nextOccurrence(s, at("2026-03-28T10:00:00Z")))).toBe("2026-03-29T08:00:00.000Z");
  });

  it("daily: a wall time in the spring gap runs after it; a doubled one runs the first time", () => {
    const gap = { kind: "daily", time: "01:30", timezone: LONDON } as const;
    expect(iso(nextOccurrence(gap, at("2026-03-28T12:00:00Z")))).toBe("2026-03-29T01:30:00.000Z");
    expect(iso(nextOccurrence(gap, at("2026-10-24T12:00:00Z")))).toBe("2026-10-25T00:30:00.000Z");
  });

  it("weekly: the next listed weekday; once: its instant or nothing", () => {
    const w = { kind: "weekly", time: "07:30", days: [1, 3], timezone: LONDON } as const;
    // Sat 24 Oct → Mon 26 Oct (GMT by then).
    expect(iso(nextOccurrence(w, at("2026-10-24T12:00:00Z")))).toBe("2026-10-26T07:30:00.000Z");
    expect(iso(nextOccurrence(w, at("2026-10-26T07:30:00Z")))).toBe("2026-10-28T07:30:00.000Z");
    const once = { kind: "once", at: "2026-11-01T10:00:00.000Z", timezone: LONDON } as const;
    expect(iso(nextOccurrence(once, at("2026-10-01T00:00:00Z")))).toBe("2026-11-01T10:00:00.000Z");
    expect(nextOccurrence(once, at("2026-11-02T00:00:00Z"))).toBeNull();
  });
});

// ---------------------------------------------------------------- host fixture

let home: string;
let sidecar: FakeSidecar;
let registry: DeviceRegistry;
let host: Host;
let hostPort: number;
let clock: number;
let H: Record<string, string>;
const nudges: { sessionId: string; title?: string; body?: string; devices: string[] }[] = [];
const fakeApns: ApnsPusher = {
  configured: true,
  async notify(nudge, devices) {
    const targets = devices.filter((d) => d.push && !d.revoked).map((d) => d.label);
    nudges.push({ ...nudge, devices: targets });
    return targets.length;
  },
  async liveActivity() {
    return "ok";
  },
};

async function startHost(tickMs = 0): Promise<Host> {
  const h = createHost({
    apns: fakeApns,
    listenPort: 0,
    publicBaseUrl: "https://mini.test:8443",
    nodeId: "mini.test",
    registry,
    offers: createPairOfferStore(),
    rings: createRingStore({ directory: join(home, "rings"), maxFrames: 50 }),
    sidecarEndpointPath: join(home, "sidecar.json"),
    controlRootKey: "control-root-key-for-tests-0123456789",
    routinePollMs: 0,
    homeCwd: join(home, "Kleio"),
    blobTickMs: tickMs,
    now: () => new Date(clock),
  });
  await h.start();
  hostPort = (h.server.address() as { port: number }).port;
  return h;
}

function publish(sc: FakeSidecar): void {
  writeFileSync(
    join(home, "sidecar.json"),
    JSON.stringify({ port: sc.port, token: sc.token, pid: 1, startedAt: "x" }),
  );
}

beforeEach(async () => {
  nudges.length = 0;
  clock = Date.parse("2026-10-24T07:00:00Z");
  home = mkdtempSync(join(tmpdir(), "kleio-blobs-"));
  mkdirSync(join(home, "secure"), { mode: 0o700 });
  chmodSync(join(home, "secure"), 0o700);
  const keyPath = join(home, "secure", "headless-master.key");
  writeFileSync(keyPath, generateMasterKey(), { mode: 0o600 });
  registry = createDeviceRegistry({
    keychain: createFileKeychain({ keyPath }),
    storePath: join(home, "secure", "device-registry.json"),
  });
  await registry.init();
  const phone = await registry.mint("Phone"); // not admin
  if (!phone.ok) throw new Error("mint");
  await registry.setPush(phone.value.device.deviceId, {
    token: "ab".repeat(16),
    env: "sandbox",
    registeredAt: new Date().toISOString(),
  });
  H = { [DEVICE_TOKEN_HEADER]: phone.value.token };
  sidecar = await fakeSidecar();
  publish(sidecar);
  host = await startHost();
});
afterEach(async () => {
  await host.stop();
  await sidecar.close();
  rmSync(home, { recursive: true, force: true });
});

interface Res {
  status: number;
  body: any;
}
function call(method: string, path: string, body?: unknown, headers = H): Promise<Res> {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? undefined : Buffer.from(JSON.stringify(body));
    const req = httpRequest(
      {
        host: "127.0.0.1",
        port: hostPort,
        method,
        path,
        headers: {
          ...(data ? { "content-type": "application/json", "content-length": data.length } : {}),
          ...headers,
        },
      },
      (res) => {
        let s = "";
        res.setEncoding("utf8");
        res.on("data", (c) => (s += c));
        res.on("end", () => {
          let parsed: unknown = s;
          try {
            parsed = JSON.parse(s);
          } catch {
            // not JSON: keep the raw text
          }
          resolve({ status: res.statusCode ?? 0, body: parsed });
        });
      },
    );
    req.on("error", reject);
    if (data) req.write(data);
    req.end();
  });
}

const settle = (ms = 60): Promise<void> => new Promise((r) => setTimeout(r, ms));
const frame = (sid: string, type: string, data: unknown = {}): void =>
  sidecar.emit(sid, `data: ${JSON.stringify({ type, data })}`);
const blobCreates = (): any[] => sidecar.creates.filter((c) => c.persona);

async function newBlob(extra: Record<string, unknown> = {}): Promise<any> {
  const r = await call("POST", "/kleio/blobs", {
    name: "Gardener",
    job: "Tend the notes.",
    ...extra,
  });
  expect(r.status).toBe(200);
  return r.body.blob;
}

// ---------------------------------------------------------------- routes

describe("blobs: CRUD", () => {
  it("creates with defaults, lists, patches, deletes; any paired device, 401 without a token", async () => {
    expect((await call("GET", "/kleio/blobs", undefined, {})).status).toBe(401);
    expect((await call("GET", "/kleio/models", undefined, {})).status).toBe(401);
    expect(
      (await call("GET", "/kleio/blobs", undefined, { [DEVICE_TOKEN_HEADER]: "nope" })).status,
    ).toBe(401);

    const b = await newBlob();
    expect(b).toMatchObject({
      name: "Gardener",
      emoji: "🫧",
      color: "sky",
      job: "Tend the notes.",
      model: null,
      schedules: [],
      running: false,
    });
    expect(b.id).toMatch(/^b_[0-9a-f]{8}$/);
    expect(b).not.toHaveProperty("sessionPath");

    const list = await call("GET", "/kleio/blobs");
    expect(list.body.blobs.map((x: any) => x.id)).toEqual([b.id]);

    const p = await call("PATCH", `/kleio/blobs/${b.id}`, { emoji: "🌱", color: "mint" });
    expect(p.body.blob).toMatchObject({ emoji: "🌱", color: "mint", name: "Gardener" });
    const disk = JSON.parse(readFileSync(join(home, "blobs.json"), "utf8"));
    expect(disk.blobs[0].emoji).toBe("🌱");

    expect((await call("DELETE", `/kleio/blobs/${b.id}`)).status).toBe(200);
    expect((await call("GET", "/kleio/blobs")).body.blobs).toEqual([]);
    expect((await call("PATCH", `/kleio/blobs/${b.id}`, { name: "x" })).status).toBe(404);
  });

  it("validates with a human message, and caps blobs at 12 and schedules at 10", async () => {
    const bad = [
      {},
      { name: "", job: "x" },
      { name: "x".repeat(41), job: "x" },
      { name: "A", job: "x".repeat(8001) },
      { name: "A", job: "x", color: "blue" },
      { name: "A", job: "x", emoji: "ab" },
      { name: "A", job: "x", model: 7 },
    ];
    for (const body of bad) {
      const r = await call("POST", "/kleio/blobs", body);
      expect(r.status).toBe(400);
      expect(typeof r.body.error).toBe("string");
    }
    const b = await newBlob({ emoji: "👩‍🌾" }); // one grapheme, several code points
    const badSchedules = [
      { label: "x", prompt: "p", kind: "hourly" },
      { label: "x", prompt: "p", kind: "interval", everyMinutes: 5 },
      { label: "x", prompt: "p", kind: "daily", time: "25:00" },
      { label: "x", prompt: "p", kind: "weekly", time: "09:00", days: [] },
      { label: "x", prompt: "p", kind: "daily", time: "09:00", timezone: "Mars/Olympus" },
      { label: "x", prompt: "p", kind: "once", at: "2020-01-01T00:00:00Z" },
      { label: "", prompt: "p", kind: "daily", time: "09:00" },
    ];
    for (const body of badSchedules)
      expect((await call("POST", `/kleio/blobs/${b.id}/schedules`, body)).status).toBe(400);
    for (let i = 0; i < 10; i += 1)
      expect(
        (
          await call("POST", `/kleio/blobs/${b.id}/schedules`, {
            label: `s${i}`,
            prompt: "p",
            kind: "daily",
            time: "09:00",
          })
        ).status,
      ).toBe(200);
    expect(
      (
        await call("POST", `/kleio/blobs/${b.id}/schedules`, {
          label: "one too many",
          prompt: "p",
          kind: "daily",
          time: "09:00",
        })
      ).body.error,
    ).toMatch(/at most 10/);
    for (let i = 1; i < 12; i += 1) await newBlob({ name: `B${i}` });
    const over = await call("POST", "/kleio/blobs", { name: "Thirteenth", job: "x" });
    expect(over.status).toBe(400);
    expect(over.body.error).toMatch(/at most 12/);
  });

  it("schedule CRUD: server-set id and nextRunAt, PATCH recomputes timing, DELETE removes", async () => {
    const b = await newBlob();
    const r = await call("POST", `/kleio/blobs/${b.id}/schedules`, {
      label: "Morning",
      prompt: "Summarise yesterday.",
      kind: "daily",
      time: "09:00",
      id: "s_ignored0",
      nextRunAt: "1999-01-01T00:00:00Z",
    });
    const s = r.body.schedule;
    expect(s).toEqual({
      id: expect.stringMatching(/^s_[0-9a-f]{8}$/),
      label: "Morning",
      prompt: "Summarise yesterday.",
      kind: "daily",
      time: "09:00",
      timezone: "Europe/London",
      enabled: true,
      notify: true,
      nextRunAt: "2026-10-24T08:00:00.000Z",
    });
    expect(s.id).not.toBe("s_ignored0");
    const renamed = await call("PATCH", `/kleio/blobs/${b.id}/schedules/${s.id}`, { label: "AM" });
    expect(renamed.body.schedule).toMatchObject({ label: "AM", nextRunAt: s.nextRunAt });
    const retimed = await call("PATCH", `/kleio/blobs/${b.id}/schedules/${s.id}`, {
      kind: "interval",
      everyMinutes: 30,
    });
    expect(retimed.body.schedule).toMatchObject({
      kind: "interval",
      everyMinutes: 30,
      nextRunAt: "2026-10-24T07:30:00.000Z",
    });
    expect(retimed.body.schedule).not.toHaveProperty("time");
    const off = await call("PATCH", `/kleio/blobs/${b.id}/schedules/${s.id}`, { enabled: false });
    expect(off.body.schedule).toMatchObject({ enabled: false, nextRunAt: null });
    expect((await call("DELETE", `/kleio/blobs/${b.id}/schedules/${s.id}`)).status).toBe(200);
    expect((await call("GET", "/kleio/blobs")).body.blobs[0].schedules).toEqual([]);
  });

  it("GET /kleio/models lists private models first, via the home session", async () => {
    sidecar.models.push(
      { id: "anthropic/claude", name: "Claude", provider: "anthropic" },
      { id: DEFAULT_BLOB_MODEL, name: "Kimi K3", provider: "local", local: true },
      { id: "local/ollama/llama", provider: "local", local: true },
    );
    const r = await call("GET", "/kleio/models");
    expect(r.status).toBe(200);
    expect(r.body).toEqual({
      models: [
        { id: DEFAULT_BLOB_MODEL, label: "Kimi K3", private: true },
        { id: "local/ollama/llama", label: "local/ollama/llama", private: true },
        { id: "anthropic/claude", label: "Claude", private: false },
      ],
      defaultBlobModel: DEFAULT_BLOB_MODEL,
    });
    const pinned = JSON.parse(readFileSync(join(home, "home.json"), "utf8"));
    expect(sidecar.seen.some((s) => s.url === "/models")).toBe(true);
    expect(pinned.sessionId).toMatch(/^created-/);
  });
});

describe("blobs: conversation", () => {
  it("creates a chat session with persona + model in <home>/blobs/<id>; idempotent; single-flight", async () => {
    const b = await newBlob();
    const [one, two] = await Promise.all([
      call("GET", `/kleio/blobs/${b.id}/session`),
      call("GET", `/kleio/blobs/${b.id}/session`),
    ]);
    expect(one.status).toBe(200);
    expect(one.body).toEqual({ sessionId: two.body.sessionId, sessionPath: null, created: true });
    expect(blobCreates()).toEqual([
      {
        mode: "chat",
        chatAgent: "general",
        cwd: join(home, "Kleio", "blobs", b.id),
        persona: { name: "Gardener", instructions: "Tend the notes." },
        model: DEFAULT_BLOB_MODEL,
      },
    ]);
    const again = await call("GET", `/kleio/blobs/${b.id}/session`);
    expect(again.body).toMatchObject({ sessionId: one.body.sessionId, created: false });
    // The blob view carries the session id but never the transcript path.
    const view = (await call("GET", "/kleio/blobs")).body.blobs[0];
    expect(view.sessionId).toBe(one.body.sessionId);
    expect(view).not.toHaveProperty("sessionPath");
  });

  it("a model the sidecar refuses is a 502 'model unavailable', with no fallback", async () => {
    sidecar.unavailableModel = "local/gone";
    const b = await newBlob({ model: "local/gone" });
    const r = await call("GET", `/kleio/blobs/${b.id}/session`);
    expect(r.status).toBe(502);
    expect(r.body).toEqual({ error: "model unavailable", detail: "model unavailable: local/gone" });
    expect(blobCreates()).toHaveLength(1);
  });

  it("learns the path at run end; PATCH job retires the session and the next open resumes it with the new persona", async () => {
    const b = await newBlob({ model: "anthropic/claude" });
    const sid = (await call("GET", `/kleio/blobs/${b.id}/session`)).body.sessionId as string;
    mkdirSync(join(home, "t"), { recursive: true });
    const path = join(home, "t", "blob.jsonl");
    writeFileSync(path, "{}\n");
    sidecar.sessions.set(sid, path);
    await settle();
    frame(sid, "run_end", { runState: "idle" });
    await settle();
    expect(JSON.parse(readFileSync(join(home, "blobs.json"), "utf8")).blobs[0].sessionPath).toBe(
      path,
    );

    // Emoji alone keeps the session.
    await call("PATCH", `/kleio/blobs/${b.id}`, { emoji: "🌻" });
    expect(sidecar.disposed).toEqual([]);
    const p = await call("PATCH", `/kleio/blobs/${b.id}`, { job: "Water the plants." });
    expect(p.body.blob).not.toHaveProperty("sessionId");
    expect(sidecar.disposed).toEqual([sid]);

    const next = await call("GET", `/kleio/blobs/${b.id}/session`);
    expect(next.body).toMatchObject({ sessionPath: path, created: true });
    expect(next.body.sessionId).not.toBe(sid);
    expect(blobCreates().at(-1)).toMatchObject({
      sessionPath: path,
      persona: { name: "Gardener", instructions: "Water the plants." },
      model: "anthropic/claude",
    });

    // POST /new is a fresh conversation, no sessionPath.
    const fresh = await call("POST", `/kleio/blobs/${b.id}/new`);
    expect(fresh.body.created).toBe(true);
    expect(blobCreates().at(-1)).not.toHaveProperty("sessionPath");

    // DELETE disposes the live session; the transcript stays on disk.
    await call("DELETE", `/kleio/blobs/${b.id}`);
    expect(sidecar.disposed).toContain(fresh.body.sessionId);
    expect(readFileSync(path, "utf8")).toBe("{}\n");
  });
});

// ---------------------------------------------------------------- scheduler

describe("blobs: scheduler", () => {
  async function restart(tickMs = 20): Promise<void> {
    await host.stop();
    host = await startHost(tickMs);
  }
  async function schedule(blobId: string, body: Record<string, unknown>): Promise<any> {
    const r = await call("POST", `/kleio/blobs/${blobId}/schedules`, {
      label: "Digest",
      prompt: "Write the digest.",
      ...body,
    });
    expect(r.status).toBe(200);
    return r.body.schedule;
  }
  const runs = async (blobId: string): Promise<any[]> =>
    (await call("GET", `/kleio/blobs/${blobId}/runs`)).body.runs;

  it("fires a due schedule, closes the run with a summary on run_end, and nudges even while attached", async () => {
    const b = await newBlob();
    const s = await schedule(b.id, { kind: "interval", everyMinutes: 15 });
    await restart();
    clock += 15 * 60_000 + 1000;
    await settle(150);
    expect(sidecar.prompts).toHaveLength(1);
    const sid = sidecar.prompts[0]!.session!;
    expect(sidecar.prompts[0]!.body).toEqual({
      text: `⏰ Scheduled task "Digest":\nWrite the digest.`,
    });
    let [open] = await runs(b.id);
    expect(open).toMatchObject({ blobId: b.id, scheduleId: s.id, label: "Digest", outcome: "ok" });
    expect(open).not.toHaveProperty("endedAt");
    expect((await call("GET", "/kleio/blobs")).body.blobs[0]).toMatchObject({
      running: true,
      lastRun: { id: open.id },
    });
    const sched = (await call("GET", "/kleio/blobs")).body.blobs[0].schedules[0];
    expect(sched.nextRunAt).toBe(new Date(Date.parse(s.nextRunAt) + 15 * 60_000).toISOString());
    expect(sched.lastRun).toMatchObject({ outcome: "ran" });

    // Someone is watching: the scheduled result is still a nudge.
    const watch = httpRequest({
      host: "127.0.0.1",
      port: hostPort,
      path: `/events?session=${sid}`,
      headers: { accept: "text/event-stream", ...H },
    });
    watch.end();
    await settle();
    frame(sid, "run_start", { text: "x" });
    frame(sid, "text_delta", { text: "Looking…" });
    frame(sid, "tool_call_start", { name: "read" });
    frame(sid, "text_delta", { text: "Three notes " });
    frame(sid, "text_delta", { text: "need watering." });
    frame(sid, "run_end", { runState: "idle", failed: false });
    await settle();
    watch.destroy();
    [open] = await runs(b.id);
    expect(open).toMatchObject({ outcome: "ok", summary: "Three notes need watering." });
    expect(open.endedAt).toBeTruthy();
    expect(nudges).toEqual([
      {
        sessionId: sid,
        title: "🫧 Gardener",
        body: "Three notes need watering.",
        devices: ["Phone"],
      },
    ]);
    expect((await call("GET", "/kleio/blobs")).body.blobs[0].running).toBe(false);
  });

  it("fires at most one schedule per tick; a busy conversation is logged as skipped", async () => {
    const b = await newBlob();
    const other = await newBlob({ name: "Other" });
    await schedule(b.id, { kind: "interval", everyMinutes: 15, label: "A" });
    await schedule(other.id, { kind: "interval", everyMinutes: 15, label: "B" });
    await restart(10_000); // one tick is taken by hand below: too slow to fire on its own
    clock += 16 * 60_000;
    await restart(0);
    // Both are past due at start: skipped forward, not replayed.
    await settle();
    expect(sidecar.prompts).toHaveLength(0);
    const blobsNow = (await call("GET", "/kleio/blobs")).body.blobs;
    expect(Date.parse(blobsNow[0].schedules[0].nextRunAt)).toBeGreaterThan(clock);

    // Due together while the host runs: one per tick.
    await host.stop();
    host = await startHost(40);
    clock = Date.parse(blobsNow[0].schedules[0].nextRunAt) + 1000;
    await settle(25);
    expect(sidecar.prompts.length).toBeLessThanOrEqual(1);
    await settle(150);
    expect(sidecar.prompts).toHaveLength(2);

    // B's conversation is still running (no run_end yet): its next due is skipped.
    clock += 15 * 60_000;
    await settle(200);
    const bRuns = await runs(other.id);
    const aRuns = await runs(b.id);
    expect([bRuns[0].outcome, aRuns[0].outcome]).toEqual(["skipped", "skipped"]);
    expect(sidecar.prompts).toHaveLength(2);

    // Busy as the sidecar reports it (a run the frames did not show) counts too.
    const sid = sidecar.prompts[0]!.session!;
    frame(sid, "run_end", { runState: "idle" });
    await settle();
    sidecar.runStates.set(sid, "running");
    const aSched = (await call("GET", "/kleio/blobs")).body.blobs.find(
      (x: any) => x.sessionId === sid,
    ).schedules[0];
    const blobId = (await call("GET", "/kleio/blobs")).body.blobs.find(
      (x: any) => x.sessionId === sid,
    ).id;
    const r = await call("POST", `/kleio/blobs/${blobId}/schedules/${aSched.id}/run`);
    expect(r.body.run).toMatchObject({ outcome: "skipped", scheduleId: aSched.id });
  });

  it("run-now fires at once; a failed run is closed as an error; runs survive a restart", async () => {
    const b = await newBlob();
    const s = await schedule(b.id, { kind: "daily", time: "18:00", notify: false });
    const r = await call("POST", `/kleio/blobs/${b.id}/schedules/${s.id}/run`);
    expect(r.status).toBe(200);
    expect(r.body.run).toMatchObject({ scheduleId: s.id, outcome: "ok", label: "Digest" });
    const sid = sidecar.prompts[0]!.session!;
    await settle();
    frame(sid, "error", { message: "rate limited" });
    frame(sid, "run_end", { runState: "idle", failed: true });
    await settle();
    // notify is off: only the ordinary nobody-attached nudge, with no Blob title.
    expect(nudges).toEqual([{ sessionId: sid, devices: ["Phone"] }]);
    await restart(0);
    const [run] = await runs(b.id);
    expect(run).toMatchObject({ id: r.body.run.id, outcome: "error", error: "rate limited" });
    const blob = (await call("GET", "/kleio/blobs")).body.blobs[0];
    expect(blob.lastRun.id).toBe(r.body.run.id);
    expect(blob.schedules[0].lastRun).toMatchObject({ outcome: "error", error: "rate limited" });
    // Its session is tracked again after the restart.
    expect(JSON.parse(readFileSync(join(home, "sessions.json"), "utf8"))).toContain(sid);
  });

  it("a once schedule fires and then disables; one missed while down is skipped", async () => {
    const b = await newBlob();
    const s = await schedule(b.id, { kind: "once", at: new Date(clock + 60_000).toISOString() });
    const missed = await schedule(b.id, {
      kind: "once",
      at: new Date(clock + 120_000).toISOString(),
      label: "Later",
    });
    await restart();
    clock += 61_000;
    await settle(150);
    expect(sidecar.prompts).toHaveLength(1);
    await host.stop();
    clock += 10 * 60_000;
    host = await startHost(20);
    await settle(100);
    expect(sidecar.prompts).toHaveLength(1);
    const scheds = (await call("GET", "/kleio/blobs")).body.blobs[0].schedules;
    expect(scheds.find((x: any) => x.id === s.id)).toMatchObject({
      enabled: false,
      nextRunAt: null,
      lastRun: { outcome: "ran" },
    });
    expect(scheds.find((x: any) => x.id === missed.id)).toMatchObject({
      enabled: false,
      nextRunAt: null,
      lastRun: { outcome: "skipped" },
    });
  });
});

import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { request as httpRequest } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ApnsPusher } from "../src/apns.js";
import { nextOccurrence } from "../src/blob-schedule.js";
import { DEFAULT_BLOB_MODEL, defaultLook } from "../src/blobs.js";
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

describe("blobs: defaultLook", () => {
  it("is FNV-1a over the id: pinned, because the desktop computes the same for older hosts", () => {
    expect(defaultLook("b_0000aaaa")).toEqual({ shape: "drop", face: "focused" });
    expect(defaultLook("b_00000000")).toEqual({ shape: "ghost", face: "happy" });
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
/**
 * Poll for work the host does in the background: the scheduler's tick, the run
 * closing at run_end. Slow CI runners outlast a fixed pause. Checks that
 * something did NOT happen keep a fixed settle().
 */
async function until(check: () => boolean | Promise<boolean>, ms = 5000): Promise<void> {
  const t = Date.now();
  while (!(await check())) {
    if (Date.now() - t > ms) throw new Error("timed out waiting");
    await settle(20);
  }
}
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

  it("look: shape + face + colour are chosen, validated and saved; omitted is the id's default", async () => {
    const b = await newBlob({ shape: "cube", face: "wink", color: "teal" });
    expect(b).toMatchObject({ shape: "cube", face: "wink", color: "teal", emoji: "🫧" });
    const disk = JSON.parse(readFileSync(join(home, "blobs.json"), "utf8"));
    expect(disk.blobs[0]).toMatchObject({ shape: "cube", face: "wink", color: "teal" });

    for (const body of [
      { name: "A", job: "x", shape: "blob" },
      { name: "A", job: "x", face: "grumpy" },
      { name: "A", job: "x", shape: null },
    ]) {
      const r = await call("POST", "/kleio/blobs", body);
      expect(r.status).toBe(400);
      expect(r.body.error).toMatch(/^(shape|face) must be one of /);
    }
    const badPatch = await call("PATCH", `/kleio/blobs/${b.id}`, { face: "grumpy" });
    expect(badPatch.status).toBe(400);
    expect(badPatch.body.error).toMatch(/^face must be one of calm, happy, /);

    const plain = await newBlob({ name: "Plain" });
    expect({ shape: plain.shape, face: plain.face }).toEqual(defaultLook(plain.id));
    await host.stop();
    host = await startHost();
    const again = (await call("GET", `/kleio/blobs/${plain.id}`)).body.blob;
    expect({ shape: again.shape, face: again.face }).toEqual(defaultLook(plain.id));
    expect((await call("GET", `/kleio/blobs/${b.id}`)).body.blob).toMatchObject({
      shape: "cube",
      face: "wink",
      color: "teal",
    });
  });

  it("PATCH shape/face/colour keeps the conversation", async () => {
    const b = await newBlob();
    const sid = (await call("GET", `/kleio/blobs/${b.id}/session`)).body.sessionId as string;
    const p = await call("PATCH", `/kleio/blobs/${b.id}`, {
      shape: "ghost",
      face: "sleepy",
      color: "plum",
    });
    expect(p.status).toBe(200);
    expect(p.body.blob).toMatchObject({
      shape: "ghost",
      face: "sleepy",
      color: "plum",
      name: "Gardener",
      sessionId: sid,
    });
    expect(sidecar.disposed).toEqual([]);
    const disk = JSON.parse(readFileSync(join(home, "blobs.json"), "utf8"));
    expect(disk.blobs[0]).toMatchObject({ shape: "ghost", face: "sleepy", color: "plum" });
    const again = await call("GET", `/kleio/blobs/${b.id}/session`);
    expect(again.body).toMatchObject({ sessionId: sid, created: false });
    expect(blobCreates()).toHaveLength(1);
  });

  it("a saved Blob without a look (or with an unknown one) loads with its default look", async () => {
    await host.stop();
    const record = {
      emoji: "🫧",
      color: "sky",
      job: "Old job.",
      model: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      schedules: [],
    };
    writeFileSync(
      join(home, "blobs.json"),
      JSON.stringify({
        blobs: [
          { ...record, id: "b_0000aaaa", name: "Old" },
          { ...record, id: "b_00000000", name: "Odd", shape: "hexagon", face: "wink" },
        ],
      }),
    );
    host = await startHost();
    const list = (await call("GET", "/kleio/blobs")).body.blobs as Record<string, unknown>[];
    expect(list.map((x) => [x.id, x.shape, x.face, x.emoji])).toEqual([
      ["b_0000aaaa", "drop", "focused", "🫧"],
      ["b_00000000", "ghost", "wink", "🫧"],
    ]);
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
      source: "manual",
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

describe("blobs: auto-schedules", () => {
  const TIMED = [
    "Here you go:",
    JSON.stringify({
      schedules: [
        {
          label: "Outfit",
          prompt: "Check the weather and suggest an outfit.",
          kind: "weekly",
          time: "07:30",
          days: [5, 1, 2, 3, 4],
        },
        { label: "Evening {wrap}", prompt: "Wrap up the day.", kind: "daily", time: "18:00" },
        { label: "Too often", prompt: "Nag.", kind: "interval", everyMinutes: 5 },
      ],
    }),
    "Anything else? {not json}",
  ].join("\n");

  it("a 'daily' that names days becomes weekly; seven named days become daily", async () => {
    sidecar.completeText = JSON.stringify({
      schedules: [
        {
          label: "Dinner idea",
          prompt: "Suggest dinner.",
          kind: "daily",
          time: "17:30",
          days: [1, 2, 3, 4, 5],
        },
        {
          label: "Every day",
          prompt: "Hi.",
          kind: "weekly",
          time: "09:00",
          days: [0, 1, 2, 3, 4, 5, 6],
        },
      ],
    });
    const r = await call("POST", "/kleio/blobs", { name: "Chef", job: "Every weekday at 17:30…" });
    expect(r.body.autoSchedules).toEqual({ status: "ok", count: 2 });
    const [weekday, everyDay] = r.body.blob.schedules;
    expect(weekday).toMatchObject({ kind: "weekly", time: "17:30", days: [1, 2, 3, 4, 5] });
    // Sat 24 Oct 2026 07:00Z → next weekday 17:30 London is Mon 26 Oct (GMT).
    expect(weekday.nextRunAt).toBe("2026-10-26T17:30:00.000Z");
    expect(everyDay).toMatchObject({ kind: "daily", time: "09:00" });
    expect(everyDay.days).toBeUndefined();
  });

  it("create with timing: adds auto schedules with nextRunAt and source auto", async () => {
    sidecar.completeText = TIMED;
    const r = await call("POST", "/kleio/blobs", {
      name: "Stylist",
      job: "Every weekday at 7:30 pick my outfit; wrap up each evening.",
    });
    expect(r.status).toBe(200);
    expect(r.body.autoSchedules).toEqual({ status: "ok", count: 2 });
    const [outfit, evening, ...rest] = r.body.blob.schedules;
    expect(rest).toEqual([]);
    expect(outfit).toEqual({
      id: expect.stringMatching(/^s_[0-9a-f]{8}$/),
      label: "Outfit",
      prompt: "Check the weather and suggest an outfit.",
      kind: "weekly",
      time: "07:30",
      days: [1, 2, 3, 4, 5],
      timezone: "Europe/London",
      enabled: true,
      notify: true,
      source: "auto",
      // Saturday 24 Oct (BST) → Monday 26 Oct 07:30 GMT.
      nextRunAt: "2026-10-26T07:30:00.000Z",
    });
    expect(evening).toMatchObject({
      label: "Evening {wrap}",
      source: "auto",
      nextRunAt: "2026-10-24T17:00:00.000Z",
    });
    expect(sidecar.completions).toHaveLength(1);
    const c = sidecar.completions[0];
    expect(c).toMatchObject({
      model: DEFAULT_BLOB_MODEL,
      prompt: "Every weekday at 7:30 pick my outfit; wrap up each evening.",
      maxTokens: 800,
    });
    expect(c.system).toMatch(/^You turn a helper's job description into schedules\./);
    expect(c.system).toMatch(/Now: Saturday, 24 Oct 2026 08:00 in Europe\/London\.$/);
    // Persisted.
    const got = await call("GET", `/kleio/blobs/${r.body.blob.id}`);
    expect(got.body.blob.schedules.map((s: any) => s.source)).toEqual(["auto", "auto"]);
  });

  it("the device's timezone is used for the prompt and the schedules", async () => {
    sidecar.completeText = TIMED;
    const r = await call("POST", "/kleio/blobs", {
      name: "Stylist",
      job: "Weekday outfits.",
      timezone: "America/New_York",
    });
    expect(sidecar.completions[0].system).toMatch(/Now: Saturday, 24 Oct 2026 03:00 in America/);
    expect(r.body.blob.schedules[0]).toMatchObject({
      timezone: "America/New_York",
      nextRunAt: "2026-10-26T11:30:00.000Z",
    });
    const bad = await call("POST", "/kleio/blobs", { name: "X", job: "Y", timezone: "Mars/Base" });
    expect(bad.status).toBe(400);
    expect(bad.body.error).toMatch(/timezone/);
    const bad2 = await call("POST", "/kleio/blobs", { name: "X", job: "Y", autoSchedule: "no" });
    expect(bad2.status).toBe(400);
  });

  it("no timing → none", async () => {
    const r = await call("POST", "/kleio/blobs", { name: "Gardener", job: "Tend the notes." });
    expect(r.body.autoSchedules).toEqual({ status: "none", count: 0 });
    expect(r.body.blob.schedules).toEqual([]);
  });

  it("junk or a 502 → failed, and the Blob still exists", async () => {
    sidecar.completeText = "I could not say.";
    const junk = await call("POST", "/kleio/blobs", { name: "A", job: "Daily at 9." });
    expect(junk.status).toBe(200);
    expect(junk.body.autoSchedules).toEqual({
      status: "failed",
      count: 0,
      error: expect.stringMatching(/no schedules/),
    });
    sidecar.completeText = '{"schedules":[{"label":"x","kind":"daily","time":"25:00"}]}';
    const invalid = await call("POST", "/kleio/blobs", { name: "B", job: "Daily at 9." });
    expect(invalid.body.autoSchedules).toMatchObject({ status: "failed", count: 0 });
    sidecar.completeStatus = 502;
    const down = await call("POST", "/kleio/blobs", { name: "C", job: "Daily at 9." });
    expect(down.status).toBe(200);
    expect(down.body.autoSchedules).toEqual({
      status: "failed",
      count: 0,
      error: "POST /complete -> 502: provider failed",
    });
    const all = (await call("GET", "/kleio/blobs")).body.blobs;
    expect(all.map((b: any) => b.name)).toEqual(["A", "B", "C"]);
    expect(all.every((b: any) => b.schedules.length === 0)).toBe(true);
  });

  it("PATCH job replaces the auto schedules and keeps the manual ones", async () => {
    sidecar.completeText = TIMED;
    const b = (await call("POST", "/kleio/blobs", { name: "Stylist", job: "Outfits." })).body.blob;
    const manual = await call("POST", `/kleio/blobs/${b.id}/schedules`, {
      label: "Mine",
      prompt: "Do my thing.",
      kind: "daily",
      time: "12:00",
    });
    expect(manual.body.schedule.source).toBe("manual");
    // Editing an auto schedule keeps it auto.
    const edited = await call("PATCH", `/kleio/blobs/${b.id}/schedules/${b.schedules[0].id}`, {
      label: "Outfit!",
    });
    expect(edited.body.schedule.source).toBe("auto");
    // No job change → no extraction.
    const renamed = await call("PATCH", `/kleio/blobs/${b.id}`, { name: "Dresser" });
    expect(renamed.body).not.toHaveProperty("autoSchedules");
    expect(sidecar.completions).toHaveLength(1);

    sidecar.completeText =
      '{"schedules":[{"label":"Hourly","prompt":"Check.","kind":"interval","everyMinutes":60}]}';
    const r = await call("PATCH", `/kleio/blobs/${b.id}`, { job: "Check hourly." });
    expect(r.body.autoSchedules).toEqual({ status: "ok", count: 1 });
    expect(r.body.blob.schedules.map((s: any) => [s.label, s.source])).toEqual([
      ["Mine", "manual"],
      ["Hourly", "auto"],
    ]);
    expect(r.body.blob.schedules[1].nextRunAt).toBe("2026-10-24T08:00:00.000Z");

    // A failed re-read leaves the schedules alone; none removes the auto ones.
    sidecar.completeStatus = 502;
    const failed = await call("PATCH", `/kleio/blobs/${b.id}`, { job: "Check twice hourly." });
    expect(failed.body.autoSchedules.status).toBe("failed");
    expect(failed.body.blob.schedules).toHaveLength(2);
    sidecar.completeStatus = 200;
    sidecar.completeText = '{"schedules":[]}';
    const none = await call("PATCH", `/kleio/blobs/${b.id}`, { job: "Whenever." });
    expect(none.body.autoSchedules).toEqual({ status: "none", count: 0 });
    expect(none.body.blob.schedules.map((s: any) => s.label)).toEqual(["Mine"]);

    // autoSchedule:false on a job change skips the re-read.
    const skip = await call("PATCH", `/kleio/blobs/${b.id}`, {
      job: "Every morning.",
      autoSchedule: false,
    });
    expect(skip.body).not.toHaveProperty("autoSchedules");
    expect(sidecar.completions).toHaveLength(4);
  });

  it("autoSchedule:false skips extraction", async () => {
    sidecar.completeText = TIMED;
    const r = await call("POST", "/kleio/blobs", {
      name: "Quiet",
      job: "Every weekday at 7:30.",
      autoSchedule: false,
    });
    expect(r.status).toBe(200);
    expect(r.body).not.toHaveProperty("autoSchedules");
    expect(r.body.blob.schedules).toEqual([]);
    expect(sidecar.completions).toHaveLength(0);
  });

  it("suggest-schedules previews without writing anything", async () => {
    sidecar.completeText = TIMED;
    const r = await call("POST", "/kleio/blobs/suggest-schedules", {
      job: "Weekday outfits.",
      model: "anthropic/claude",
      timezone: "Asia/Tokyo",
    });
    expect(r.status).toBe(200);
    expect(r.body.schedules).toHaveLength(2);
    expect(r.body.schedules[0]).toEqual({
      label: "Outfit",
      prompt: "Check the weather and suggest an outfit.",
      kind: "weekly",
      time: "07:30",
      days: [1, 2, 3, 4, 5],
      timezone: "Asia/Tokyo",
      enabled: true,
      notify: true,
    });
    expect(sidecar.completions[0].model).toBe("anthropic/claude");
    expect((await call("GET", "/kleio/blobs")).body.blobs).toEqual([]);
    expect(() => readFileSync(join(home, "blobs.json"), "utf8")).toThrow();
    expect((await call("POST", "/kleio/blobs/suggest-schedules", {})).status).toBe(400);
    sidecar.completeStatus = 502;
    const down = await call("POST", "/kleio/blobs/suggest-schedules", { job: "Daily." });
    expect(down.status).toBe(502);
    expect(down.body.error).toMatch(/502/);
  });

  it("schedules saved before auto-schedules read as manual", async () => {
    await host.stop();
    writeFileSync(
      join(home, "blobs.json"),
      JSON.stringify({
        blobs: [
          {
            id: "b_0000aaaa",
            name: "Old",
            emoji: "🫧",
            color: "sky",
            job: "Old job.",
            model: null,
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z",
            schedules: [
              {
                id: "s_0000aaaa",
                label: "Old",
                prompt: "Go.",
                kind: "daily",
                time: "09:00",
                timezone: "Europe/London",
                enabled: true,
                notify: true,
                nextRunAt: "2026-10-24T08:00:00.000Z",
              },
            ],
          },
        ],
      }),
    );
    host = await startHost();
    const b = (await call("GET", "/kleio/blobs/b_0000aaaa")).body.blob;
    expect(b.schedules[0].source).toBe("manual");
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
    const storedPath = (): unknown => {
      try {
        return JSON.parse(readFileSync(join(home, "blobs.json"), "utf8")).blobs[0].sessionPath;
      } catch {
        return undefined;
      }
    };
    await until(() => storedPath() === path);
    expect(storedPath()).toBe(path);

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

  it("reports the running run's tool calls for the chat, and none between runs", async () => {
    const b = await newBlob();
    const sid = (await call("GET", `/kleio/blobs/${b.id}/session`)).body.sessionId as string;
    await settle();
    const calls = async (): Promise<any[]> =>
      (await call("GET", `/kleio/blobs/${b.id}/activity`)).body.activity;

    frame(sid, "run_start", { text: "x" });
    frame(sid, "tool_call_start", {
      toolCallId: "t1",
      name: "bash",
      args: { command: "pnpm  test\n  --run" },
    });
    frame(sid, "tool_call_end", { toolCallId: "t1", isError: true });
    frame(sid, "server_tool_call", { id: "s1", name: "web_search", input: { query: "rain" } });
    frame(sid, "tool_call_start", { toolCallId: "t2", name: "read", args: { file_path: "a.md" } });
    await until(async () => (await calls()).length === 3);
    expect((await calls()).map((e) => [e.name, e.summary, e.status])).toEqual([
      ["bash", "pnpm test --run", "failed"],
      ["web_search", "rain", "done"],
      ["read", "a.md", "running"],
    ]);

    frame(sid, "run_end", { runState: "idle" });
    await until(async () => (await calls()).length === 0);
    // The next run starts clean, not with the last one's calls.
    frame(sid, "run_start", { text: "y" });
    await settle();
    expect(await calls()).toEqual([]);
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
    await until(() => sidecar.prompts.length > 0);
    await settle(); // ...and no second fire right behind it
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
    await until(async () => nudges.length > 0 && (await runs(b.id))[0]?.outcome === "ok");
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
    await until(() => sidecar.prompts.length >= 2);
    await settle();
    expect(sidecar.prompts).toHaveLength(2);

    // B's conversation is still running (no run_end yet): its next due is skipped.
    clock += 15 * 60_000;
    await until(
      async () =>
        (await runs(other.id))[0]?.outcome === "skipped" &&
        (await runs(b.id))[0]?.outcome === "skipped",
    );
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
    await until(() => nudges.length > 0);
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
    await until(() => sidecar.prompts.length > 0);
    await settle();
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

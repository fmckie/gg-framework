import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { request as httpRequest } from "node:http";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ApnsPusher } from "../src/apns.js";
import { createDeviceRegistry, type DeviceRegistry } from "../src/device-registry.js";
import { createFileKeychain, generateMasterKey } from "../src/file-keychain.js";
import {
  byRelevance,
  groupInstructions,
  mentioned,
  promptFor,
  type GroupMessage,
  type GroupRouter,
  type RouteRequest,
} from "../src/groups.js";
import { createHost, DEVICE_TOKEN_HEADER, type Host } from "../src/host.js";
import { createPairOfferStore } from "../src/pair-offer.js";
import { createRingStore } from "../src/sse-ring.js";
import { toolSummary } from "../src/tool-activity.js";
import { fakeSidecar, type FakeSidecar } from "./fake-sidecar.js";

// ---------------------------------------------------------------- host fixture

let home: string;
let sidecar: FakeSidecar;
let registry: DeviceRegistry;
let host: Host;
let hostPort: number;
let clock: number;
let H: Record<string, string>;
const nudges: {
  sessionId?: string;
  groupId?: string;
  title?: string;
  body?: string;
  devices: string[];
}[] = [];
const fakeApns: ApnsPusher = {
  configured: true,
  async notify(nudge, devices) {
    const targets = devices.filter((d) => d.push && !d.revoked).map((d) => d.label);
    nudges.push({ ...nudge, devices: targets });
    return targets.length;
  },
  async liveActivity(target, push) {
    lives.push({
      event: push.event,
      state: push.contentState,
      alert: push.alert,
      priority: push.priority,
    });
    return "ok";
  },
};
const lives: {
  event: string;
  state: Record<string, unknown>;
  alert?: unknown;
  priority: number;
}[] = [];

let turnTimeoutMs = 2_000;
/** The groups' router; by default it never answers (as without a Jev key). */
let routeWith: GroupRouter = async () => null;
/** The host's log lines. */
const logs: string[] = [];
async function startHost(tickMs = 0): Promise<Host> {
  const h = createHost({
    apns: fakeApns,
    log: (msg) => logs.push(msg),
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
    groupTurnTimeoutMs: turnTimeoutMs,
    groupRouter: (req, signal) => routeWith(req, signal),
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
  lives.length = 0;
  logs.length = 0;
  turnTimeoutMs = 2_000;
  routeWith = async () => null;
  clock = Date.parse("2026-10-24T07:00:00Z");
  home = mkdtempSync(join(tmpdir(), "kleio-groups-"));
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

// ---------------------------------------------------------------- helpers

const blob = (id: string, name: string, job = "Helps."): any => ({
  id,
  name,
  job,
  emoji: "🫧",
  color: "sky",
  model: null,
  createdAt: "",
  updatedAt: "",
  schedules: [],
});

async function newBlob(name: string, job = `I am ${name}.`): Promise<any> {
  const r = await call("POST", "/kleio/blobs", { name, job, autoSchedule: false });
  expect(r.status).toBe(200);
  return r.body.blob;
}

async function newGroup(members: string[], extra: Record<string, unknown> = {}): Promise<any> {
  const r = await call("POST", "/kleio/groups", { name: "Team", members, ...extra });
  expect(r.status).toBe(200);
  return r.body.group;
}

/** Which Blob a created session belongs to: its persona name. */
function nameOf(sessionId: string): string | undefined {
  return sidecar.createdBodies.get(sessionId)?.persona?.name;
}

/** A group conversation's folder, in this platform's path form (\ on Windows). */
const GROUPS_DIR = `${sep}groups${sep}`;

/** The session ids created for group conversations. */
const groupSessions = (): string[] =>
  [...sidecar.createdBodies].filter(([, b]) => b.cwd?.includes(GROUPS_DIR)).map(([id]) => id);

async function until(check: () => boolean | Promise<boolean>, ms = 3000): Promise<void> {
  const t = Date.now();
  while (!(await check())) {
    if (Date.now() - t > ms) throw new Error("timed out waiting");
    await settle(20);
  }
}

async function allMessages(gid: string): Promise<any[]> {
  return (await call("GET", `/kleio/groups/${gid}/messages?after=0`)).body.messages;
}

/** The whole GET .../messages body: messages, typing, activity, outcomes. */
async function page(gid: string): Promise<any> {
  return (await call("GET", `/kleio/groups/${gid}/messages?after=0`)).body;
}

const iso = (ms: number): string => new Date(ms).toISOString();

/** Wait until the group's queue has drained (no typing for a moment). */
async function quiet(gid: string): Promise<void> {
  let calm = 0;
  await until(async () => {
    const r = await call("GET", `/kleio/groups/${gid}`);
    calm = r.body.group.typing.length === 0 ? calm + 1 : 0;
    return calm >= 4;
  });
}

// ---------------------------------------------------------------- pure

describe("groups: mentions, persona, prompt", () => {
  const chef = blob("b_00000001", "Chef");
  const chefBot = blob("b_00000002", "Chef Bot");
  const coach = blob("b_00000003", "Coach");

  it("matches @names case-insensitively, longest first, in the order mentioned", () => {
    expect(mentioned("@chef bot and @COACH please", [chef, chefBot, coach])).toEqual([
      "b_00000002",
      "b_00000003",
    ]);
    expect(mentioned("@Chef, then @Chef Bot", [chef, chefBot, coach])).toEqual([
      "b_00000001",
      "b_00000002",
    ]);
    expect(
      mentioned("@Coach first, then @Chef Bot, then @coach again", [chef, chefBot, coach]),
    ).toEqual(["b_00000003", "b_00000002"]);
    expect(mentioned("email chef@example.com, @Chefs", [chef])).toEqual([]);
    expect(mentioned("no mentions here", [chef, coach])).toEqual([]);
  });

  it("relevance: a member named first, then shared words with name and job; ties keep member order", () => {
    const writer = blob("b_00000004", "Writer", "Drafts blog posts.");
    const builder = blob("b_00000005", "Builder", "Runs builds and fixes failures.");
    expect(byRelevance("Can you fix the failing build?", [writer, builder])).toEqual([
      "b_00000005",
      "b_00000004",
    ]);
    expect(byRelevance("Writer, can you fix the failing build?", [builder, writer])).toEqual([
      "b_00000004",
      "b_00000005",
    ]);
    expect(byRelevance("hello", [writer, builder])).toEqual(["b_00000004", "b_00000005"]);
  });

  it("group instructions: the job, the roster, PASS", () => {
    const s = groupInstructions({ name: "Kitchen" }, chef, [coach]);
    expect(s.startsWith("Helps.")).toBe(true);
    expect(s).toContain('group chat "Kitchen" with: Coach — Helps.');
    expect(s).toContain("reply exactly PASS");
  });

  it("prompt: unseen messages as [Name]: text, capped at 30", () => {
    const msgs: GroupMessage[] = Array.from({ length: 40 }, (_, i) => ({
      seq: i + 1,
      id: `m_${i}`,
      author: "you",
      authorName: "You",
      emoji: "🙂",
      text: `hello ${i + 1}`,
      at: "",
    }));
    const p = promptFor(msgs).split("\n");
    expect(p).toHaveLength(30);
    expect(p[0]).toBe("[You]: hello 11");
    expect(p[29]).toBe("[You]: hello 40");
  });
});

// ---------------------------------------------------------------- routes

describe("groups: CRUD", () => {
  it("creates, lists, patches and deletes; validates", async () => {
    const a = await newBlob("Chef");
    const b = await newBlob("Coach");
    expect((await call("POST", "/kleio/groups", { name: "", members: [a.id] })).status).toBe(400);
    expect((await call("POST", "/kleio/groups", { name: "X", members: [] })).status).toBe(400);
    expect(
      (await call("POST", "/kleio/groups", { name: "X", members: ["b_deadbeef"] })).status,
    ).toBe(400);
    expect((await call("POST", "/kleio/groups", { name: "X", members: [a.id, a.id] })).status).toBe(
      400,
    );
    expect((await call("GET", "/kleio/groups", undefined, {})).status).toBe(401);

    const g = await newGroup([a.id, b.id]);
    expect(g).toMatchObject({ name: "Team", emoji: "💬", color: "lilac", members: [a.id, b.id] });
    expect(g.id).toMatch(/^g_[0-9a-f]{8}$/);
    expect(g.typing).toEqual([]);
    expect(g.sessions).toBeUndefined();

    const list = await call("GET", "/kleio/groups");
    expect(list.body.groups.map((x: any) => x.id)).toEqual([g.id]);

    const p = await call("PATCH", `/kleio/groups/${g.id}`, { name: "Crew", members: [b.id] });
    expect(p.status).toBe(200);
    expect(p.body.group).toMatchObject({ name: "Crew", members: [b.id] });

    expect((await call("DELETE", `/kleio/groups/${g.id}`)).status).toBe(200);
    expect((await call("GET", "/kleio/groups")).body.groups).toEqual([]);
    expect(JSON.parse(readFileSync(join(home, "groups.json"), "utf8")).groups).toEqual([]);
  });
});

describe("groups: the conductor", () => {
  it("no mention: every member replies, in member order, as its own conversation", async () => {
    const a = await newBlob("Chef");
    const b = await newBlob("Coach");
    const g = await newGroup([a.id, b.id]);
    sidecar.autoReply = (sid) => `${nameOf(sid)} here.`;

    const sent = await call("POST", `/kleio/groups/${g.id}/messages`, { text: "Plan my week" });
    expect(sent.status).toBe(200);
    expect(sent.body.message).toMatchObject({ seq: 1, author: "you", text: "Plan my week" });
    await until(async () => (await allMessages(g.id)).length === 3);
    const msgs = await allMessages(g.id);
    expect(msgs.map((m) => [m.authorName, m.text])).toEqual([
      ["You", "Plan my week"],
      ["Chef", "Chef here."],
      ["Coach", "Coach here."],
    ]);
    // One conversation per (group, Blob), with the group persona and cwd.
    const creates = sidecar.creates.filter((c) => c.cwd?.includes(GROUPS_DIR));
    expect(creates.map((c) => c.persona.name)).toEqual(["Chef", "Coach"]);
    expect(creates[0].cwd).toBe(join(home, "Kleio", "groups", g.id, a.id));
    expect(creates[0].persona.instructions).toContain('group chat "Team" with: Coach');
    // Coach saw Chef's reply too.
    const coachPrompt = sidecar.prompts.find((p) => nameOf(p.session!) === "Coach")!;
    expect(coachPrompt.body.text).toBe("[You]: Plan my week\n[Chef]: Chef here.");
  });

  it("@mention: only them; a second message shows only what's new", async () => {
    const a = await newBlob("Chef");
    const b = await newBlob("Coach");
    const g = await newGroup([a.id, b.id]);
    sidecar.autoReply = (sid) => `${nameOf(sid)} ok.`;

    await call("POST", `/kleio/groups/${g.id}/messages`, { text: "@coach how many reps?" });
    await until(async () => (await allMessages(g.id)).length === 2);
    await quiet(g.id);
    expect((await allMessages(g.id)).map((m) => m.authorName)).toEqual(["You", "Coach"]);

    await call("POST", `/kleio/groups/${g.id}/messages`, { text: "@Coach and sets?" });
    await until(async () => (await allMessages(g.id)).length === 4);
    const coachPrompts = sidecar.prompts.filter((p) => nameOf(p.session!) === "Coach");
    expect(coachPrompts.map((p) => p.body.text)).toEqual([
      "[You]: @coach how many reps?",
      "[You]: @Coach and sets?",
    ]);
  });

  it("a reply that @mentions another member hands the turn on", async () => {
    const a = await newBlob("Chef");
    const b = await newBlob("Coach");
    const g = await newGroup([a.id, b.id]);
    sidecar.autoReply = (sid) =>
      nameOf(sid) === "Chef" ? "@Coach what protein target?" : "180 g a day.";

    await call("POST", `/kleio/groups/${g.id}/messages`, { text: "@Chef dinner ideas" });
    await until(async () => (await allMessages(g.id)).length === 3);
    expect((await allMessages(g.id)).map((m) => m.authorName)).toEqual(["You", "Chef", "Coach"]);
  });

  it("@mentions reply in the order mentioned, not member order", async () => {
    const a = await newBlob("Chef");
    const b = await newBlob("Coach");
    const g = await newGroup([a.id, b.id]);
    sidecar.autoReply = (sid) => `${nameOf(sid)} ok.`;

    await call("POST", `/kleio/groups/${g.id}/messages`, { text: "@Coach first, then @Chef" });
    await until(async () => (await allMessages(g.id)).length === 3);
    expect((await allMessages(g.id)).map((m) => m.authorName)).toEqual(["You", "Coach", "Chef"]);
  });

  it("pauses after 10 turns in a row with no tool use", async () => {
    const a = await newBlob("Chef");
    const b = await newBlob("Coach");
    const g = await newGroup([a.id, b.id]);
    sidecar.autoReply = (sid) => (nameOf(sid) === "Chef" ? "@Coach over to you" : "@Chef back");

    await call("POST", `/kleio/groups/${g.id}/messages`, { text: "@Chef go" });
    await until(async () => (await allMessages(g.id)).length === 11);
    await quiet(g.id);
    expect(await allMessages(g.id)).toHaveLength(11); // you + 10 replies, one a turn
    // Coach's last reply asked Chef again, after the guard tripped.
    expect((await page(g.id)).outcomes).toEqual({
      [a.id]: {
        kind: "budget_exhausted",
        reason: "the group paused after 10 turns with no tool use",
      },
      [b.id]: { kind: "replied", reason: "" },
    });
    expect(logs).toContain(
      `[groups] ${g.id}: paused after 10 turns in a row with no tool call; not reached: Chef`,
    );
  });

  it("a PASS counts toward the stall: a router loop of chat and PASSes pauses after 10 turns", async () => {
    const a = await newBlob("Chef");
    const b = await newBlob("Coach");
    const g = await newGroup([a.id, b.id]);
    // The router never calls it done: it hands the turn to whoever it may.
    routeWith = async (req) => ({
      ranked: req.members.map((m) => m.id),
      stop: false,
      note: "next",
    });
    // Chef chats (no tool, no @mention); Coach, nudged, passes.
    sidecar.autoReply = (sid) => (nameOf(sid) === "Chef" ? "Still thinking." : "PASS");

    await call("POST", `/kleio/groups/${g.id}/messages`, { text: "Plan dinner" });
    await until(() => logs.some((l) => l.includes(": paused after ")));
    await quiet(g.id);
    // 10 turns: Chef's 5 replies and Coach's 5 PASSes. Counting only the
    // replies, it ran 19.
    expect(sidecar.prompts).toHaveLength(10);
    const authors = (await allMessages(g.id)).map((m) => m.authorName);
    expect(authors).toEqual(["You", "Chef", "Chef", "Chef", "Chef", "Chef"]);
    expect((await page(g.id)).outcomes).toEqual({
      [a.id]: {
        kind: "budget_exhausted",
        reason: "the group paused after 10 turns with no tool use",
      },
      [b.id]: { kind: "passed", reason: "had nothing to add" },
    });
    expect(logs).toContain(
      `[groups] ${g.id}: paused after 10 turns in a row with no tool call; not reached: Chef`,
    );
  });

  it("members who use tools work on past 35 turns", async () => {
    const a = await newBlob("Chef");
    const b = await newBlob("Coach");
    const g = await newGroup([a.id, b.id]);
    // 40 replies; only every 10th calls a tool, so 9 in a row go without one.
    let replies = 0;
    sidecar.autoReply = (sid) => {
      replies += 1;
      const text =
        replies === 40 ? "All done." : nameOf(sid) === "Chef" ? "@Coach over to you" : "@Chef back";
      return { text, tools: replies % 10 === 0 ? ["bash"] : [] };
    };

    await call("POST", `/kleio/groups/${g.id}/messages`, { text: "@Chef go" });
    await until(async () => (await allMessages(g.id)).length === 41, 10_000);
    await quiet(g.id);
    expect(await allMessages(g.id)).toHaveLength(41); // you + 40 replies
    expect((await page(g.id)).outcomes).toEqual({
      [a.id]: { kind: "replied", reason: "" },
      [b.id]: { kind: "replied", reason: "" },
    });
    expect(logs.filter((l) => l.includes("paused"))).toEqual([]);
  });

  it("stops at the 200-turn ceiling, even when every turn uses a tool", async () => {
    const a = await newBlob("Chef");
    const b = await newBlob("Coach");
    const g = await newGroup([a.id, b.id]);
    const reg = await call("POST", "/kleio/live-activity", {
      groupId: g.id,
      token: "ef".repeat(32),
      env: "sandbox",
    });
    expect(reg.status).toBe(200);
    // Busy ping-pong: every turn calls a tool, so the stall guard never trips.
    sidecar.autoReply = (sid) => ({
      text: nameOf(sid) === "Chef" ? "@Coach over to you" : "@Chef back",
      tools: ["bash"],
    });

    await call("POST", `/kleio/groups/${g.id}/messages`, { text: "@Chef go" });
    await until(() => lives.some((l) => l.event === "end"), 25_000);
    await quiet(g.id);
    expect(sidecar.prompts).toHaveLength(200);
    // You, then 200 replies.
    const rest = await call("GET", `/kleio/groups/${g.id}/messages?after=201`);
    expect(rest.body).toMatchObject({ messages: [], lastSeq: 201 });
    // Coach's reply on turn 200 asked Chef again, past the ceiling.
    expect((await page(g.id)).outcomes).toEqual({
      [a.id]: { kind: "budget_exhausted", reason: "the group used all 200 turns for this message" },
      [b.id]: { kind: "replied", reason: "" },
    });
    expect(logs).toContain(`[groups] ${g.id}: paused at the 200-turn ceiling; not reached: Chef`);
    expect(logs.filter((l) => l.includes("no tool call"))).toEqual([]);
    expect(lives.at(-1)!.state).toMatchObject({ phase: "stopped", line: "Paused after 200 turns" });
  }, 30_000);

  it("PASS and empty replies post nothing; typing shows while a turn runs", async () => {
    const a = await newBlob("Chef");
    const b = await newBlob("Coach");
    const g = await newGroup([a.id, b.id]);
    sidecar.autoReply = null; // drive the frames by hand

    await call("POST", `/kleio/groups/${g.id}/messages`, { text: "anything?" });
    await until(() => sidecar.prompts.length === 1);
    const r = await call("GET", `/kleio/groups/${g.id}/messages?after=0`);
    expect(r.body.typing).toEqual([a.id]);
    const chefSid = sidecar.prompts[0]!.session!;
    frame(chefSid, "run_start");
    frame(chefSid, "text_delta", { text: "PASS" });
    frame(chefSid, "run_end");
    await until(() => sidecar.prompts.length === 2);
    const coachSid = sidecar.prompts[1]!.session!;
    frame(coachSid, "run_start");
    frame(coachSid, "run_end");
    await quiet(g.id);
    expect((await allMessages(g.id)).map((m) => m.author)).toEqual(["you"]);
    expect((await page(g.id)).outcomes).toEqual({
      [a.id]: { kind: "passed", reason: "had nothing to add" },
      [b.id]: { kind: "passed", reason: "sent an empty reply" },
    });
    expect(logs).toContain(`[groups] ${g.id}: Chef passed`);
    expect(logs).toContain(`[groups] ${g.id}: Coach sent an empty reply`);
  });

  it("a turn that never ends times out and the queue moves on", async () => {
    await host.stop();
    turnTimeoutMs = 150;
    host = await startHost();
    const a = await newBlob("Chef");
    const b = await newBlob("Coach");
    const g = await newGroup([a.id, b.id]);
    sidecar.autoReply = (sid) => (nameOf(sid) === "Chef" ? null : "Coach here.");

    await call("POST", `/kleio/groups/${g.id}/messages`, { text: "hi" });
    await until(async () => (await allMessages(g.id)).length === 2);
    expect((await allMessages(g.id)).map((m) => m.authorName)).toEqual(["You", "Coach"]);
    await quiet(g.id);
    expect((await page(g.id)).outcomes).toEqual({
      [a.id]: { kind: "timed_out", reason: "took over 150 ms" },
      [b.id]: { kind: "replied", reason: "" },
    });
    expect(logs).toContain(`[groups] ${g.id}: Chef took too long`);
  });

  it("after= pages the log", async () => {
    const a = await newBlob("Chef");
    const g = await newGroup([a.id]);
    sidecar.autoReply = () => "ok";
    for (const t of ["one", "two", "three"]) {
      await call("POST", `/kleio/groups/${g.id}/messages`, { text: t });
      await quiet(g.id);
    }
    const all = await allMessages(g.id);
    expect(all).toHaveLength(6);
    const page = await call("GET", `/kleio/groups/${g.id}/messages?after=2&limit=2`);
    expect(page.body.messages.map((m: any) => m.seq)).toEqual([3, 4]);
    expect(page.body.lastSeq).toBe(4);
    const empty = await call("GET", `/kleio/groups/${g.id}/messages?after=6`);
    expect(empty.body).toMatchObject({ messages: [], lastSeq: 6 });
  });
});

describe("groups: the router", () => {
  it("picks who starts, hands the turn on with a nudge, and stops when the work is done", async () => {
    const a = await newBlob("Chef");
    const b = await newBlob("Coach");
    const w = await newBlob("Writer");
    const g = await newGroup([a.id, b.id, w.id]);
    sidecar.autoReply = (sid) => `${nameOf(sid)} did a part.`;
    const asked: RouteRequest[] = [];
    routeWith = async (req) => {
      asked.push(req);
      if (req.first) return { ranked: [w.id, a.id], stop: false, note: "next 0.90" };
      if (asked.length === 2) return { ranked: [a.id, w.id], stop: false, note: "next 0.80" };
      return { ranked: [b.id], stop: true, note: "next 0.50, done 0.95" };
    };

    await call("POST", `/kleio/groups/${g.id}/messages`, { text: "Plan my week" });
    await until(() => asked.length === 3);
    await quiet(g.id);
    expect((await allMessages(g.id)).map((m) => m.authorName)).toEqual(["You", "Writer", "Chef"]);
    expect(asked.map((r) => r.first)).toEqual([true, false, false]);
    expect(asked[0]).toMatchObject({
      group: "Team",
      earlier: [],
      conversation: [{ from: "User", text: "Plan my week" }],
    });
    expect(asked[0]!.members.map((m) => m.name)).toEqual(["Chef", "Coach", "Writer"]);
    expect(asked[1]!.conversation.map((m) => m.from)).toEqual(["User", "Writer"]);
    // The router's first pick just answers; a later pick is told to carry on.
    const prompt = (name: string): string =>
      sidecar.prompts.find((p) => nameOf(p.session!) === name)!.body.text;
    expect(prompt("Writer")).toBe("[You]: Plan my week");
    expect(prompt("Chef")).toBe(
      "[You]: Plan my week\n[Writer]: Writer did a part.\n[Kleio]: It's your turn: carry on " +
        "with your part of the user's request, or reply PASS if there's nothing you can do.",
    );
    expect(logs).toContain(`[groups] ${g.id}: stops (next 0.50, done 0.95)`);
  });

  it("a member that passed isn't offered again until someone replies, nor one that just replied", async () => {
    const a = await newBlob("Chef");
    const b = await newBlob("Coach");
    const g = await newGroup([a.id, b.id]);
    sidecar.autoReply = (sid) => (nameOf(sid) === "Coach" ? "PASS" : "Done.");
    const asked: RouteRequest[] = [];
    routeWith = async (req) => {
      asked.push(req);
      if (asked.length === 3) return { ranked: [b.id], stop: true, note: "done 0.90" };
      return { ranked: [b.id, a.id], stop: false, note: "next" };
    };

    await call("POST", `/kleio/groups/${g.id}/messages`, { text: "Dinner?" });
    await until(() => asked.length === 3);
    await quiet(g.id);
    expect((await allMessages(g.id)).map((m) => m.authorName)).toEqual(["You", "Chef"]);
    expect(asked.map((r) => r.members.map((m) => m.name))).toEqual([
      ["Chef", "Coach"],
      // Coach passed: not offered again yet.
      ["Chef"],
      // Chef replied: Coach may pick it up, not straight back to Chef.
      ["Coach"],
    ]);
  });

  it("a member who passed after replying still shows as replied", async () => {
    const a = await newBlob("Chef");
    const b = await newBlob("Coach");
    const g = await newGroup([a.id, b.id]);
    let chefTurns = 0;
    sidecar.autoReply = (sid) => {
      if (nameOf(sid) === "Coach") return "Coach here.";
      chefTurns += 1;
      return chefTurns === 1 ? "Chef's plan." : "PASS";
    };
    const asked: RouteRequest[] = [];
    routeWith = async (req) => {
      asked.push(req);
      if (req.first) return { ranked: [a.id], stop: false, note: "first" };
      if (asked.length === 2) return { ranked: [b.id], stop: false, note: "coach" };
      if (asked.length === 3) return { ranked: [a.id], stop: false, note: "chef again" };
      return { ranked: [b.id], stop: true, note: "done 0.90" };
    };

    await call("POST", `/kleio/groups/${g.id}/messages`, { text: "Plan dinner" });
    await until(() => asked.length === 4);
    await quiet(g.id);
    expect((await allMessages(g.id)).map((m) => m.authorName)).toEqual(["You", "Chef", "Coach"]);
    // Chef's second turn was a PASS, but it did reply to this message.
    expect((await page(g.id)).outcomes[a.id]).toEqual({ kind: "replied", reason: "" });
  });

  it("a message sent while the router decides is worked on, not dropped", async () => {
    const a = await newBlob("Chef");
    const b = await newBlob("Coach");
    const g = await newGroup([a.id, b.id]);
    sidecar.autoReply = (sid) => `${nameOf(sid)} here.`;
    let release = (): void => {};
    const gate = new Promise<void>((r) => (release = r));
    let calls = 0;
    routeWith = async (req) => {
      calls += 1;
      if (req.first) return { ranked: [a.id], stop: false, note: "first" };
      if (calls === 2) await gate; // still deciding when the next message comes in
      return { ranked: [a.id], stop: true, note: "done 0.90" };
    };

    await call("POST", `/kleio/groups/${g.id}/messages`, { text: "Plan dinner" });
    await until(() => calls === 2);
    await call("POST", `/kleio/groups/${g.id}/messages`, { text: "@Coach and a workout?" });
    release();
    await until(async () => (await allMessages(g.id)).length === 4);
    await quiet(g.id);
    expect((await allMessages(g.id)).map((m) => m.authorName)).toEqual([
      "You",
      "Chef",
      "You",
      "Coach",
    ]);
  });

  it("with no answer, everyone replies, most relevant first, then the group stops", async () => {
    const w = await newBlob("Writer", "Drafts blog posts.");
    const b = await newBlob("Builder", "Runs builds and fixes failures.");
    const g = await newGroup([w.id, b.id]);
    sidecar.autoReply = (sid) => `${nameOf(sid)} here.`;

    await call("POST", `/kleio/groups/${g.id}/messages`, {
      text: "Can you fix the failing build?",
    });
    await until(async () => (await allMessages(g.id)).length === 3);
    await quiet(g.id);
    expect((await allMessages(g.id)).map((m) => m.authorName)).toEqual([
      "You",
      "Builder",
      "Writer",
    ]);
    expect(logs).toContain(`[groups] ${g.id}: no route; every member replies, most relevant first`);
  });
});

describe("groups: new session", () => {
  it("clears the conversation, keeps the old log on disk, and starts fresh conversations", async () => {
    const a = await newBlob("Chef");
    const b = await newBlob("Coach");
    const g = await newGroup([a.id, b.id]);
    sidecar.autoReply = (sid) => `${nameOf(sid)} here.`;
    await call("POST", `/kleio/groups/${g.id}/messages`, { text: "Plan my week" });
    await until(async () => (await allMessages(g.id)).length === 3);
    await quiet(g.id);
    const before = groupSessions();
    expect(before).toHaveLength(2);

    const r = await call("POST", `/kleio/groups/${g.id}/new`);
    expect(r.status).toBe(200);
    expect(r.body.group).toMatchObject({ id: g.id, clearedThrough: 3 });
    expect(r.body.group.lastMessage).toBeUndefined();
    expect(sidecar.disposed).toEqual(expect.arrayContaining(before));
    expect(await page(g.id)).toMatchObject({
      messages: [],
      lastSeq: 3,
      clearedThrough: 3,
      activity: {},
      outcomes: {},
    });
    const setAside = readdirSync(home).filter(
      (f) => f.startsWith(`group-${g.id}.`) && f !== `group-${g.id}.jsonl`,
    );
    expect(setAside).toHaveLength(1);
    expect(readFileSync(join(home, setAside[0]!), "utf8").trim().split("\n")).toHaveLength(3);

    // seq carries on, so a device polling after=3 sees what's new.
    await call("POST", `/kleio/groups/${g.id}/messages`, { text: "Again" });
    const newer = async (): Promise<any[]> =>
      (await call("GET", `/kleio/groups/${g.id}/messages?after=3`)).body.messages;
    await until(async () => (await newer()).length === 3);
    expect((await newer()).map((m) => [m.seq, m.authorName])).toEqual([
      [4, "You"],
      [5, "Chef"],
      [6, "Coach"],
    ]);
    // Each member starts a new conversation (no resume) and sees only the new message.
    const fresh = groupSessions().filter((id) => !before.includes(id));
    expect(fresh).toHaveLength(2);
    for (const id of fresh) expect(sidecar.createdBodies.get(id).sessionPath).toBeUndefined();
    const chef = sidecar.prompts.filter((x) => nameOf(x.session!) === "Chef");
    expect(chef.at(-1)!.body.text).toBe("[You]: Again");

    // Deleting the group deletes the set-aside log too.
    expect((await call("DELETE", `/kleio/groups/${g.id}`)).status).toBe(200);
    expect(readdirSync(home).filter((f) => f.startsWith(`group-${g.id}`))).toEqual([]);
  });

  it("a turn still running is cancelled, and its late reply is dropped", async () => {
    const a = await newBlob("Chef");
    const g = await newGroup([a.id]);
    sidecar.autoReply = null; // the run answers only when the test says so
    await call("POST", `/kleio/groups/${g.id}/messages`, { text: "Slow one" });
    await until(() => groupSessions().length === 1 && sidecar.prompts.length === 1);
    const sid = groupSessions()[0]!;

    expect((await call("POST", `/kleio/groups/${g.id}/new`)).status).toBe(200);
    frame(sid, "run_start");
    frame(sid, "text_delta", { text: "Late reply" });
    frame(sid, "run_end", {});
    await quiet(g.id);
    expect((await page(g.id)).messages).toEqual([]);
    expect(sidecar.seen.some((s) => s.method === "POST" && s.url.startsWith("/cancel"))).toBe(true);
  });
});

describe("groups: member activity and outcomes", () => {
  it("summarises tool args as one clipped line, from known keys only", () => {
    expect(toolSummary({ command: "ls  -la\n  src", timeout: 5 })).toBe("ls -la src");
    expect(toolSummary({ pattern: "TODO", path: "src" })).toBe("TODO");
    expect(toolSummary({ urls: [1, "https://a.test"] })).toBe("https://a.test");
    expect(toolSummary({ content: "a file body", text: "a message" })).toBe("");
    expect(toolSummary(null)).toBe("");
    const long = toolSummary({ command: "x".repeat(500) });
    expect([...long]).toHaveLength(120);
    expect(long.endsWith("…")).toBe(true);
  });

  it("tool calls show while a turn runs, end done or failed, and never carry output", async () => {
    const a = await newBlob("Chef");
    const g = await newGroup([a.id]);
    sidecar.autoReply = null;
    await call("POST", `/kleio/groups/${g.id}/messages`, { text: "check the logs" });
    await until(() => sidecar.prompts.length === 1);
    const sid = sidecar.prompts[0]!.session!;
    frame(sid, "run_start");
    frame(sid, "tool_call_start", {
      toolCallId: "t1",
      name: "bash",
      args: { command: `grep -r ${"x".repeat(300)} .`, timeout: 9 },
    });
    frame(sid, "tool_call_start", {
      toolCallId: "t2",
      name: "write",
      args: { file_path: "/tmp/notes.md", content: "SECRET-ARG" },
    });
    await until(async () => (await page(g.id)).activity?.[a.id]?.length === 2);
    let p = await page(g.id);
    expect(p.typing).toEqual([a.id]);
    expect(p.outcomes).toEqual({});
    const [bash, write] = p.activity[a.id];
    expect(bash).toEqual({
      id: "t1",
      name: "bash",
      summary: expect.stringMatching(/^grep -r x+…$/),
      status: "running",
      startedAt: iso(clock),
    });
    expect([...bash.summary]).toHaveLength(120);
    expect(write).toMatchObject({ id: "t2", summary: "/tmp/notes.md", status: "running" });

    const started = clock;
    clock += 1500;
    frame(sid, "tool_call_end", {
      toolCallId: "t1",
      result: "SECRET-OUTPUT",
      isError: false,
      durationMs: 1500,
    });
    frame(sid, "tool_call_end", {
      toolCallId: "t2",
      result: "EACCES SECRET-OUTPUT",
      isError: true,
      durationMs: 3,
    });
    await until(async () =>
      (await page(g.id)).activity[a.id].every((e: any) => e.status !== "running"),
    );
    p = await page(g.id);
    expect(p.activity[a.id].map((e: any) => [e.status, e.startedAt, e.endedAt])).toEqual([
      ["done", iso(started), iso(clock)],
      ["failed", iso(started), iso(clock)],
    ]);
    expect(JSON.stringify(p)).not.toContain("SECRET");

    frame(sid, "text_delta", { text: "Logs are clean." });
    frame(sid, "run_end");
    await quiet(g.id);
    p = await page(g.id);
    expect(p.outcomes).toEqual({ [a.id]: { kind: "replied", reason: "" } });
    expect(p.activity[a.id]).toHaveLength(2); // kept until the next turn
    expect(JSON.stringify(p.activity)).not.toContain("Logs are clean");
  });

  it("a member's next turn starts a fresh list; a turn keeps its last 30 calls", async () => {
    const a = await newBlob("Chef");
    const g = await newGroup([a.id]);
    sidecar.autoReply = null;
    await call("POST", `/kleio/groups/${g.id}/messages`, { text: "one" });
    await until(() => sidecar.prompts.length === 1);
    const sid = sidecar.prompts[0]!.session!;
    frame(sid, "run_start");
    for (let i = 1; i <= 35; i++)
      frame(sid, "tool_call_start", { toolCallId: `t${i}`, name: "read", args: { path: `f${i}` } });
    await until(async () => (await page(g.id)).activity?.[a.id]?.at(-1)?.id === "t35");
    const ids = (await page(g.id)).activity[a.id].map((e: any) => e.id);
    expect(ids).toHaveLength(30);
    expect(ids[0]).toBe("t6");
    frame(sid, "text_delta", { text: "Read them." });
    frame(sid, "run_end");
    await quiet(g.id);

    await call("POST", `/kleio/groups/${g.id}/messages`, { text: "two" });
    await until(() => sidecar.prompts.length === 2);
    const p = await page(g.id);
    expect(p.typing).toEqual([a.id]);
    expect(p.activity).toEqual({ [a.id]: [] });
    expect(p.outcomes).toEqual({});
    frame(sid, "run_start");
    frame(sid, "run_end");
    await quiet(g.id);
  });

  it("a failed run records why, and closes its open calls as failed", async () => {
    const a = await newBlob("Chef");
    const g = await newGroup([a.id]);
    sidecar.autoReply = null;
    await call("POST", `/kleio/groups/${g.id}/messages`, { text: "go" });
    await until(() => sidecar.prompts.length === 1);
    const sid = sidecar.prompts[0]!.session!;
    frame(sid, "run_start");
    frame(sid, "tool_call_start", {
      toolCallId: "t1",
      name: "web_fetch",
      args: { url: "https://example.test" },
    });
    frame(sid, "error", { headline: "Rate limited", message: "Try again in 30s", guidance: "" });
    frame(sid, "run_end", { failed: true });
    await quiet(g.id);
    const p = await page(g.id);
    expect(p.outcomes).toEqual({
      [a.id]: { kind: "failed", reason: "Rate limited: Try again in 30s" },
    });
    expect(p.activity[a.id].map((e: any) => [e.summary, e.status])).toEqual([
      ["https://example.test", "failed"],
    ]);
    expect(logs).toContain(`[groups] ${g.id}: Chef's run failed: Rate limited: Try again in 30s`);
    expect((await allMessages(g.id)).map((m) => m.author)).toEqual(["you"]);
  });

  it("a hook's follow-up PASS keeps the answer before it; narration is never an answer", async () => {
    const a = await newBlob("Chef");
    const g = await newGroup([a.id]);
    sidecar.autoReply = null;
    await call("POST", `/kleio/groups/${g.id}/messages`, { text: "plan dinner" });
    await until(() => sidecar.prompts.length === 1);
    const sid = sidecar.prompts[0]!.session!;
    // As on the Mac mini: an answer, then the completion hook's hidden
    // diagnostics nudge, which the member closes with PASS.
    frame(sid, "run_start");
    frame(sid, "text_delta", { text: "Checking the pantry." });
    frame(sid, "turn_end", { stopReason: "tool_use" });
    frame(sid, "tool_call_start", { toolCallId: "t1", name: "edit", args: { path: "menu.py" } });
    frame(sid, "tool_call_end", { toolCallId: "t1", isError: false });
    frame(sid, "text_delta", { text: "Lentil curry tonight; " });
    frame(sid, "text_delta", { text: "the menu is in menu.py." });
    frame(sid, "turn_end", { stopReason: "end_turn" });
    frame(sid, "diagnostics", { text: "Post-edit diagnostics: menu.py: not verified." });
    frame(sid, "text_delta", { text: "PASS" });
    frame(sid, "turn_end", { stopReason: "end_turn" });
    frame(sid, "run_end", { failed: false });
    await quiet(g.id);
    expect((await allMessages(g.id)).map((m) => m.text)).toEqual([
      "plan dinner",
      "Lentil curry tonight; the menu is in menu.py.",
    ]);
    expect((await page(g.id)).outcomes).toEqual({ [a.id]: { kind: "replied", reason: "" } });

    // Text before a tool call, then PASS: a pass, not a reply.
    await call("POST", `/kleio/groups/${g.id}/messages`, { text: "and dessert?" });
    await until(() => sidecar.prompts.length === 2);
    frame(sid, "run_start");
    frame(sid, "text_delta", { text: "Let me look." });
    frame(sid, "turn_end", { stopReason: "tool_use" });
    frame(sid, "tool_call_start", { toolCallId: "t2", name: "read", args: { path: "menu.py" } });
    frame(sid, "tool_call_end", { toolCallId: "t2", isError: false });
    frame(sid, "text_delta", { text: "PASS" });
    frame(sid, "turn_end", { stopReason: "end_turn" });
    frame(sid, "run_end", { failed: false });
    await quiet(g.id);
    expect((await allMessages(g.id)).map((m) => m.author)).toEqual(["you", a.id, "you"]);
    expect((await page(g.id)).outcomes).toEqual({
      [a.id]: { kind: "passed", reason: "had nothing to add" },
    });
  });

  it("a member whose conversation can't open is recorded as unavailable", async () => {
    const a = await newBlob("Chef");
    const g = await newGroup([a.id]);
    sidecar.failCreate = true;
    await call("POST", `/kleio/groups/${g.id}/messages`, { text: "hi" });
    await until(async () => (await page(g.id)).outcomes?.[a.id] !== undefined);
    expect((await page(g.id)).outcomes[a.id]).toMatchObject({ kind: "unavailable" });
    expect(logs.some((l) => l.startsWith(`[groups] ${g.id}: Chef unavailable:`))).toBe(true);
  });
});

describe("groups: notifications", () => {
  it("one push per exchange when nobody is watching; none while the group is polled", async () => {
    const a = await newBlob("Chef");
    const b = await newBlob("Coach");
    const g = await newGroup([a.id, b.id], { emoji: "🍳" });
    sidecar.autoReply = (sid) => `${nameOf(sid)} says hi.`;

    // Nobody has polled: one push for the whole exchange, from the last reply.
    await call("POST", `/kleio/groups/${g.id}/messages`, { text: "hello" });
    await until(() => nudges.length === 1);
    await settle(100);
    expect(nudges).toHaveLength(1);
    expect(nudges[0]).toMatchObject({
      groupId: g.id,
      kind: "message",
      name: "Team",
      author: "Coach",
      text: "Coach says hi.",
    });
    // Members' own run ends send no per-session nudge.
    expect(nudges.some((n) => n.sessionId)).toBe(false);

    // Polled just now (the chat is on screen): no push.
    await allMessages(g.id);
    await call("POST", `/kleio/groups/${g.id}/messages`, { text: "again" });
    await until(async () => (await allMessages(g.id)).length === 6);
    await quiet(g.id);
    expect(nudges).toHaveLength(1);
  });
});

describe("groups: Live Activity", () => {
  const register = async (gid: string): Promise<void> => {
    const r = await call("POST", "/kleio/live-activity", {
      groupId: gid,
      token: "ef".repeat(32),
      env: "sandbox",
    });
    expect(r.status).toBe(200);
  };
  const lines = (): string[] => lives.map((l) => `${l.event}:${String(l.state.line)}`);

  it("starts, names the member and its step, and ends Done", async () => {
    const a = await newBlob("Chef");
    const g = await newGroup([a.id]);
    await register(g.id);
    sidecar.autoReply = null;
    await call("POST", `/kleio/groups/${g.id}/messages`, { text: "check the logs" });
    await until(() => sidecar.prompts.length === 1);
    const sid = sidecar.prompts[0]!.session!;
    frame(sid, "run_start");
    frame(sid, "tool_call_start", {
      toolCallId: "t1",
      name: "read",
      args: { path: "/x/notes.md" },
    });
    frame(sid, "text_delta", { text: "All good." });
    frame(sid, "turn_end", { stopReason: "end_turn" });
    frame(sid, "run_end", {});
    await quiet(g.id);
    await until(() => lives.some((l) => l.event === "end"));
    expect(lines()[0]).toBe("update:Starting…");
    // "Chef is on it" / the step are routine updates inside the 5 s window: the end supersedes them.
    expect(lines()).toEqual(["update:Starting…", "end:Done"]);
    expect(lines().at(-1)).toBe("end:Done");
    expect(lives.at(-1)!.state.phase).toBe("done");
    expect(lives.every((l) => !l.alert)).toBe(true);
  });

  it("member steps reach the activity as '<Member> · <step>'", async () => {
    const a = await newBlob("Chef");
    const g = await newGroup([a.id]);
    sidecar.autoReply = null;
    await call("POST", `/kleio/groups/${g.id}/messages`, { text: "go" });
    await until(() => sidecar.prompts.length === 1);
    const sid = sidecar.prompts[0]!.session!;
    frame(sid, "tool_call_start", { toolCallId: "t1", name: "edit", args: { path: "/x/a.ts" } });
    await settle(80);
    await register(g.id); // catches up with the latest state
    await until(() => lives.length > 0);
    expect(lives[0]!.state).toMatchObject({ phase: "working", line: "Chef · Editing a.ts" });
    frame(sid, "run_end", {});
    await quiet(g.id);
  });

  it("waiting on the user: needsYou with an alert, and no plain notification", async () => {
    const a = await newBlob("Chef");
    const b = await newBlob("Coach");
    const g = await newGroup([a.id, b.id]);
    await register(g.id);
    sidecar.autoReply = (sid) => `${nameOf(sid)}: which day suits you?`;
    routeWith = async (req) =>
      req.first
        ? { ranked: [a.id], stop: false, note: "next" }
        : { ranked: [b.id], stop: true, note: "waiting 0.9", reason: "waiting" };
    await call("POST", `/kleio/groups/${g.id}/messages`, { text: "plan" });
    await until(() => lives.some((l) => l.state.phase === "needsYou"));
    await settle(100);
    const ask = lives.find((l) => l.state.phase === "needsYou")!;
    expect(ask).toMatchObject({
      event: "update",
      priority: 10,
      alert: { title: "Team", sound: "default" },
      state: { line: "Needs your help", detail: "Chef: Chef: which day suits you?" },
    });
    expect(nudges).toHaveLength(0);
  });

  it("a member's question: shown with its buttons, answered through the group, then back to work", async () => {
    const a = await newBlob("Chef");
    const g = await newGroup([a.id]);
    await register(g.id);
    sidecar.autoReply = null;
    await call("POST", `/kleio/groups/${g.id}/messages`, { text: "plan dinner" });
    await until(() => sidecar.prompts.length === 1);
    const sid = sidecar.prompts[0]!.session!;
    const prompt = {
      id: "ask-1",
      questions: [
        {
          id: "q1",
          question: "Fish or veg?",
          kind: "choice",
          options: [{ label: "Fish" }, { label: "Veg" }],
        },
      ],
    };
    frame(sid, "run_start");
    await page(g.id); // the chat is open (polling)
    frame(sid, "ask_user", prompt);
    await until(async () => Object.keys((await page(g.id)).asks).length === 1);

    // The chat gets the whole question, buttons and all, under the member's id.
    expect((await page(g.id)).asks).toEqual({ [a.id]: prompt });
    // Someone is watching: the activity says so, without an alert.
    const ask = lives.find((l) => l.state.phase === "needsYou");
    expect(ask).toMatchObject({ state: { detail: "Chef: Fish or veg?" } });
    expect(ask?.alert).toBeUndefined();

    const r = await call("POST", `/kleio/groups/${g.id}/ask/ask-1`, {
      action: "answer",
      answers: { q1: "Veg" },
    });
    expect(r.status).toBe(200);
    expect(sidecar.asks).toEqual([
      { id: "ask-1", session: sid, body: { action: "answer", answers: { q1: "Veg" } } },
    ]);
    expect((await page(g.id)).asks).toEqual({});
    // A second answer, or one to a question nobody asked, is refused.
    const again = await call("POST", `/kleio/groups/${g.id}/ask/ask-1`, {
      action: "answer",
      answers: { q1: "Fish" },
    });
    expect(again.status).toBe(409);
    expect(sidecar.asks).toHaveLength(1);

    frame(sid, "text_delta", { text: "Veg it is." });
    frame(sid, "turn_end", { stopReason: "end_turn" });
    frame(sid, "run_end", {});
    await quiet(g.id);
    expect((await allMessages(g.id)).map((m) => m.text)).toEqual(["plan dinner", "Veg it is."]);
  });

  it("a member's question with nobody watching lights the phone up", async () => {
    const a = await newBlob("Chef");
    const g = await newGroup([a.id]);
    await register(g.id);
    sidecar.autoReply = null;
    await call("POST", `/kleio/groups/${g.id}/messages`, { text: "plan" });
    await until(() => sidecar.prompts.length === 1);
    const sid = sidecar.prompts[0]!.session!;
    frame(sid, "ask_user", {
      id: "ask-2",
      questions: [{ id: "q", question: "When?", kind: "text" }],
    });
    await until(() => lives.some((l) => l.state.phase === "needsYou"));
    expect(lives.find((l) => l.state.phase === "needsYou")).toMatchObject({
      priority: 10,
      alert: { title: "Team" },
      state: { detail: "Chef: When?" },
    });
    // Answered on the Mac (the sidecar settles it): back to work.
    frame(sid, "ask_user_done", { id: "ask-2" });
    await until(() => lives.at(-1)?.state.line === "Chef is on it");
    frame(sid, "run_end", {});
    await quiet(g.id);
  });

  it("Stop ends the reply in progress and the queue, keeps the conversation", async () => {
    const a = await newBlob("Chef");
    const b = await newBlob("Coach");
    const g = await newGroup([a.id, b.id]);
    await register(g.id);
    sidecar.autoReply = null;
    await call("POST", `/kleio/groups/${g.id}/messages`, { text: "@Chef then @Coach: plan" });
    await until(() => sidecar.prompts.length === 1);
    const sid = sidecar.prompts[0]!.session!;

    expect((await call("POST", `/kleio/groups/${g.id}/stop`)).status).toBe(200);
    // A late reply from the stopped turn is dropped; Coach never starts.
    frame(sid, "text_delta", { text: "Too late." });
    frame(sid, "run_end", {});
    await quiet(g.id);
    expect((await allMessages(g.id)).map((m) => m.text)).toEqual(["@Chef then @Coach: plan"]);
    expect(sidecar.prompts).toHaveLength(1);
    expect(sidecar.seen.some((s) => s.method === "POST" && s.url.startsWith("/cancel"))).toBe(true);
    const p = await page(g.id);
    expect(p.typing).toEqual([]);
    expect(p.outcomes[a.id]).toEqual({ kind: "failed", reason: "you stopped it" });
    expect(lives.at(-1)?.state).toMatchObject({ phase: "stopped", line: "Stopped" });
    expect((await call("GET", `/kleio/groups/${g.id}/stop`)).status).toBe(405);

    // The group carries on with the next message.
    sidecar.autoReply = (s) => `${nameOf(s)} here.`;
    await call("POST", `/kleio/groups/${g.id}/messages`, { text: "@Coach hi" });
    await until(async () => (await allMessages(g.id)).length === 3);
  });

  it("a web search the model runs shows in the member's activity", async () => {
    const a = await newBlob("Chef");
    const g = await newGroup([a.id]);
    sidecar.autoReply = null;
    await call("POST", `/kleio/groups/${g.id}/messages`, { text: "news?" });
    await until(() => sidecar.prompts.length === 1);
    const sid = sidecar.prompts[0]!.session!;
    frame(sid, "run_start");
    frame(sid, "server_tool_call", {
      id: "srvtoolu_1",
      name: "web_search",
      input: { query: "Kenya mobile money 2026" },
    });
    await until(async () => ((await page(g.id)).activity[a.id] ?? []).length === 1);
    expect((await page(g.id)).activity[a.id]).toEqual([
      expect.objectContaining({
        name: "web_search",
        summary: "Kenya mobile money 2026",
        status: "done",
      }),
    ]);
    frame(sid, "text_delta", { text: "Found it." });
    frame(sid, "turn_end", { stopReason: "end_turn" });
    frame(sid, "run_end", {});
    await quiet(g.id);
  });

  it("refuses answers that aren't answers", async () => {
    const a = await newBlob("Chef");
    const g = await newGroup([a.id]);
    sidecar.autoReply = null;
    await call("POST", `/kleio/groups/${g.id}/messages`, { text: "plan" });
    await until(() => sidecar.prompts.length === 1);
    const sid = sidecar.prompts[0]!.session!;
    frame(sid, "ask_user", {
      id: "ask-3",
      questions: [{ id: "q", question: "When?", kind: "text" }],
    });
    await until(async () => Object.keys((await page(g.id)).asks).length === 1);
    const post = (body: unknown): Promise<any> =>
      call("POST", `/kleio/groups/${g.id}/ask/ask-3`, body);
    expect((await post({ action: "answer", answers: { q: 42 } })).status).toBe(400);
    expect((await post({ action: "answer", answers: {} })).status).toBe(400);
    expect((await post({ action: "explode" })).status).toBe(400);
    expect((await call("GET", `/kleio/groups/${g.id}/ask/ask-3`)).status).toBe(405);
    expect(sidecar.asks).toHaveLength(0);
    frame(sid, "run_end", {});
    await quiet(g.id);
  });

  it("with no activity or start token, the plain notification still goes out", async () => {
    const a = await newBlob("Chef");
    const g = await newGroup([a.id]);
    sidecar.autoReply = () => "Which day?";
    routeWith = async (req) =>
      req.first
        ? { ranked: [a.id], stop: false, note: "next" }
        : { ranked: [a.id], stop: true, note: "waiting", reason: "waiting" };
    await call("POST", `/kleio/groups/${g.id}/messages`, { text: "plan" });
    await until(() => nudges.length === 1);
    expect(lives).toHaveLength(0);
  });

  it("10 turns in a row with no tool use end it as paused", async () => {
    const a = await newBlob("Chef");
    const b = await newBlob("Coach");
    const g = await newGroup([a.id, b.id]);
    await register(g.id);
    sidecar.autoReply = (sid) => (nameOf(sid) === "Chef" ? "@Coach over to you" : "@Chef back");
    await call("POST", `/kleio/groups/${g.id}/messages`, { text: "@Chef go" });
    await until(() => lives.some((l) => l.event === "end"), 6000);
    expect(lives.at(-1)!.state).toMatchObject({
      phase: "stopped",
      line: "Paused: no tool use in 10 turns",
    });
  });
});

describe("groups: Blob changes", () => {
  it("deleting a Blob removes it from its groups and retires the group's sessions", async () => {
    const a = await newBlob("Chef");
    const b = await newBlob("Coach");
    const g = await newGroup([a.id, b.id]);
    sidecar.autoReply = (sid) => `${nameOf(sid)} here.`;
    await call("POST", `/kleio/groups/${g.id}/messages`, { text: "hi" });
    await until(async () => (await allMessages(g.id)).length === 3);
    await quiet(g.id);
    const chefInGroup = groupSessions().filter((sid) => nameOf(sid) === "Chef");
    expect(chefInGroup).toHaveLength(1);

    expect((await call("DELETE", `/kleio/blobs/${a.id}`)).status).toBe(200);
    const after = (await call("GET", "/kleio/groups")).body.groups[0];
    expect(after.members).toEqual([b.id]);
    expect(sidecar.disposed).toContain(chefInGroup[0]);
  });

  it("renaming a Blob retires its group conversations; the next turn uses the new name", async () => {
    const a = await newBlob("Chef");
    const b = await newBlob("Coach");
    const g = await newGroup([a.id, b.id]);
    sidecar.autoReply = (sid) => `${nameOf(sid)} here.`;
    await call("POST", `/kleio/groups/${g.id}/messages`, { text: "hi" });
    await until(async () => (await allMessages(g.id)).length === 3);
    await quiet(g.id);
    const before = sidecar.disposed.length;

    expect((await call("PATCH", `/kleio/blobs/${a.id}`, { name: "Cook" })).status).toBe(200);
    expect(sidecar.disposed.length).toBeGreaterThanOrEqual(before + 2);

    await call("POST", `/kleio/groups/${g.id}/messages`, { text: "@Cook dinner?" });
    await until(async () => (await allMessages(g.id)).length === 5);
    const last = (await allMessages(g.id)).at(-1);
    expect(last).toMatchObject({ authorName: "Cook", text: "Cook here." });
    const resumed = sidecar.creates.filter((c) => c.persona?.name === "Cook").at(-1);
    expect(resumed.cwd).toContain(join("groups", g.id, a.id));
    expect(resumed.persona.instructions).toContain("Coach");
  });
});

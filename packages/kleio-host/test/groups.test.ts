import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { request as httpRequest } from "node:http";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ApnsPusher } from "../src/apns.js";
import { createDeviceRegistry, type DeviceRegistry } from "../src/device-registry.js";
import { createFileKeychain, generateMasterKey } from "../src/file-keychain.js";
import { groupInstructions, mentioned, promptFor, type GroupMessage } from "../src/groups.js";
import { createHost, DEVICE_TOKEN_HEADER, type Host } from "../src/host.js";
import { createPairOfferStore } from "../src/pair-offer.js";
import { createRingStore } from "../src/sse-ring.js";
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
  async liveActivity() {
    return "ok";
  },
};

let turnTimeoutMs = 2_000;
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
    groupTurnTimeoutMs: turnTimeoutMs,
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
  turnTimeoutMs = 2_000;
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

  it("matches @names case-insensitively, longest first, in member order", () => {
    expect(mentioned("@chef bot and @COACH please", [chef, chefBot, coach])).toEqual([
      "b_00000002",
      "b_00000003",
    ]);
    expect(mentioned("@Chef, then @Chef Bot", [chef, chefBot, coach])).toEqual([
      "b_00000001",
      "b_00000002",
    ]);
    expect(mentioned("email chef@example.com, @Chefs", [chef])).toEqual([]);
    expect(mentioned("no mentions here", [chef, coach])).toEqual([]);
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

  it("stops after 6 Blob turns per user message", async () => {
    const a = await newBlob("Chef");
    const b = await newBlob("Coach");
    const g = await newGroup([a.id, b.id]);
    sidecar.autoReply = (sid) => (nameOf(sid) === "Chef" ? "@Coach over to you" : "@Chef back");

    await call("POST", `/kleio/groups/${g.id}/messages`, { text: "@Chef go" });
    await until(async () => (await allMessages(g.id)).length === 7);
    await quiet(g.id);
    expect(await allMessages(g.id)).toHaveLength(7); // you + 6 turns
  });

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
      title: "🍳 Team",
      body: "Coach: Coach says hi.",
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

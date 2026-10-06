import { mkdtempSync, readFileSync, rmSync, statSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createVoice,
  DEFAULT_MODEL,
  sessionConfig,
  VOICE_TOOLS,
  voiceErrorDetail,
  voiceErrorStatus,
  voiceInstructions,
} from "../src/voice.js";

const KEY = "sk-test-0123456789abcdef";
const OFFER = "v=0\r\no=- 1 2 IN IP4 127.0.0.1\r\n";
const ANSWER = "v=0\r\no=openai 3 4 IN IP4 10.0.0.1\r\n";

interface Seen {
  url: string;
  method: string;
  auth: string | null;
  body: unknown;
}

/** A fake OpenAI: answers each request with the next queued reply. */
function fakeOpenAI(
  replies: Array<{ status: number; body: string; headers?: Record<string, string> }>,
): {
  fetch: typeof fetch;
  seen: Seen[];
} {
  const seen: Seen[] = [];
  const f = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    seen.push({
      url: String(input),
      method: init?.method ?? "GET",
      auth: headers.get("authorization"),
      body: init?.body,
    });
    const r = replies.shift() ?? { status: 500, body: "no reply queued" };
    return new Response(r.body, { status: r.status, headers: r.headers ?? {} });
  }) as typeof fetch;
  return { fetch: f, seen };
}

describe("createVoice", () => {
  let dir: string;
  const paths = (): { keyPath: string; settingsPath: string } => ({
    keyPath: join(dir, "openai.key"),
    settingsPath: join(dir, "voice.json"),
  });

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "kleio-voice-"));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("is not ready without a key, and a call says so without asking OpenAI", async () => {
    const ai = fakeOpenAI([]);
    const v = createVoice({ ...paths(), fetch: ai.fetch, log: () => {} });
    expect(await v.status()).toMatchObject({ ready: false, voice: "marin", model: DEFAULT_MODEL });
    expect(await v.createCall(OFFER, "hi")).toEqual({ ok: false, error: { kind: "no_key" } });
    expect(ai.seen).toHaveLength(0);
  });

  it("checks a key with OpenAI before saving it, owner-only", async () => {
    const ai = fakeOpenAI([{ status: 200, body: "{}" }]);
    const v = createVoice({ ...paths(), fetch: ai.fetch, log: () => {} });
    expect(await v.setKey(`  ${KEY}\n`)).toEqual({ ok: true, value: null });
    expect(ai.seen[0]).toMatchObject({
      url: `https://api.openai.com/v1/models/${DEFAULT_MODEL}`,
      auth: `Bearer ${KEY}`,
    });
    expect(readFileSync(paths().keyPath, "utf8").trim()).toBe(KEY);
    expect(statSync(paths().keyPath).mode & 0o777).toBe(0o600);
    expect((await v.status()).ready).toBe(true);
    await v.removeKey();
    expect((await v.status()).ready).toBe(false);
  });

  it("refuses a key OpenAI rejects or one with no credit, and saves nothing", async () => {
    const ai = fakeOpenAI([
      { status: 401, body: '{"error":{"message":"Incorrect API key provided"}}' },
      { status: 429, body: '{"error":{"code":"insufficient_quota","message":"quota"}}' },
    ]);
    const v = createVoice({ ...paths(), fetch: ai.fetch, log: () => {} });
    expect(await v.setKey(KEY)).toEqual({ ok: false, error: { kind: "bad_key" } });
    expect(await v.setKey(KEY)).toEqual({ ok: false, error: { kind: "no_credit" } });
    expect(await v.setKey("two words")).toEqual({ ok: false, error: { kind: "bad_key" } });
    expect(existsSync(paths().keyPath)).toBe(false);
    expect(ai.seen).toHaveLength(2);
  });

  it("asks OpenAI for the call with the offer, the session and the key, and returns its answer", async () => {
    const ai = fakeOpenAI([
      { status: 200, body: "{}" },
      { status: 201, body: ANSWER, headers: { location: "/v1/realtime/calls/rtc_abc" } },
    ]);
    const v = createVoice({ ...paths(), fetch: ai.fetch, log: () => {} });
    await v.setKey(KEY);
    await v.setVoice("cedar");
    const r = await v.createCall(OFFER, "Be Kleio.");
    expect(r).toEqual({ ok: true, value: { sdp: ANSWER, callId: "rtc_abc" } });
    const call = ai.seen[1];
    expect(call).toMatchObject({
      url: "https://api.openai.com/v1/realtime/calls",
      method: "POST",
      auth: `Bearer ${KEY}`,
    });
    const form = call?.body as FormData;
    expect(form.get("sdp")).toBe(OFFER);
    const session = JSON.parse(String(form.get("session"))) as Record<string, unknown>;
    expect(session).toMatchObject({
      type: "realtime",
      model: DEFAULT_MODEL,
      instructions: "Be Kleio.",
      audio: { output: { voice: "cedar" } },
    });
  });

  it("never lets the key into an error a device sees", async () => {
    const ai = fakeOpenAI([
      { status: 200, body: "{}" },
      { status: 400, body: `{"error":{"message":"bad request for ${KEY}"}}` },
    ]);
    const v = createVoice({ ...paths(), fetch: ai.fetch, log: () => {} });
    await v.setKey(KEY);
    const r = await v.createCall(OFFER, "x");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(JSON.stringify(voiceErrorDetail(r.error))).not.toContain(KEY);
    expect(voiceErrorDetail(r.error).detail).toContain("[key]");
    expect(voiceErrorStatus(r.error)).toBe(502);
  });

  it("prefers the environment's key over the file", async () => {
    const ai = fakeOpenAI([{ status: 201, body: ANSWER }]);
    const v = createVoice({ ...paths(), apiKey: "sk-env", fetch: ai.fetch, log: () => {} });
    expect((await v.status()).ready).toBe(true);
    await v.createCall(OFFER, "x");
    expect(ai.seen[0]?.auth).toBe("Bearer sk-env");
  });
});

describe("the session", () => {
  it("tells Kleio who she is, the time and what's new", () => {
    const text = voiceInstructions({
      now: new Date("2026-10-07T09:30:00Z"),
      brief: "Chef finished. Here are three dinner ideas.",
    });
    expect(text).toContain("You are Kleio");
    expect(text).toContain("7 October");
    expect(text).toContain("What's new right now: Chef finished. Here are three dinner ideas.");
    expect(text).toMatch(/send_plan only after they say yes/);
  });

  it("offers only reading tools and the agreed-plan pair", () => {
    expect(VOICE_TOOLS.map((t) => t.name)).toEqual([
      "get_briefing",
      "list_specialists",
      "read_specialist",
      "list_groups",
      "read_group",
      "draft_plan",
      "send_plan",
      "end_conversation",
    ]);
    const s = sessionConfig({ voice: "marin", model: DEFAULT_MODEL }, "x");
    expect(s).toMatchObject({
      tool_choice: "auto",
      audio: {
        input: {
          noise_reduction: { type: "near_field" },
          transcription: { model: "gpt-4o-mini-transcribe", language: "en" },
          turn_detection: { type: "semantic_vad" },
        },
      },
    });
    const laptop = sessionConfig({ voice: "marin", model: DEFAULT_MODEL }, "x", "far");
    expect(laptop).toMatchObject({ audio: { input: { noise_reduction: { type: "far_field" } } } });
  });
});

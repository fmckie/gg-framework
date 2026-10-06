import { describe, expect, it } from "vitest";
import { jevRouter, routeQuestions, routeState } from "../src/group-router.js";
import type { RouteRequest } from "../src/groups.js";
import { createJev, JEV_NOT_SET_UP, parseAnswer, type Jev, type JevAnswer } from "../src/jev.js";

const members = [
  { id: "b_00000001", name: "Chef", job: "Cooks." },
  { id: "b_00000002", name: "Coach", job: "Trains." },
];
const request = (first: boolean): RouteRequest => ({
  group: "Team",
  members,
  earlier: [{ from: "User", text: "hi" }],
  conversation: [{ from: "User", text: "Plan dinner" }],
  first,
});

const NEXT = {
  type: "choice",
  instructions: "Who?",
  criteria: { b_00000001: "Chef", b_00000002: "Coach" },
} as const;
const DONE = { type: "noul", instructions: "Done?" } as const;

describe("jev: the System One client", () => {
  it("posts the state and questions with the key, and reads typed answers", async () => {
    const sent: { url: string; init: RequestInit | undefined }[] = [];
    const jev = createJev({
      apiKey: async () => "k-123",
      fetch: async (url, init) => {
        sent.push({ url: String(url), init });
        return new Response(
          JSON.stringify({
            model: "jev-latest",
            answers: {
              next: {
                type: "choice",
                choice: "b_00000002",
                confidence: 0.9,
                probabilities: { b_00000001: 0.1, b_00000002: 0.9 },
              },
              done: { type: "noul", noul: 0.2 },
            },
          }),
        );
      },
    });

    const r = await jev.ask({ a: 1 }, { next: NEXT, done: DONE });
    expect(r).toEqual({
      ok: true,
      value: {
        next: {
          type: "choice",
          choice: "b_00000002",
          probabilities: { b_00000001: 0.1, b_00000002: 0.9 },
        },
        done: { type: "noul", noul: 0.2 },
      },
    });
    expect(sent).toHaveLength(1);
    expect(sent[0]!.url).toBe("https://api.typesafe.ai/v1/systemone");
    expect(new Headers(sent[0]!.init?.headers).get("authorization")).toBe("Bearer k-123");
    expect(JSON.parse(String(sent[0]!.init?.body))).toEqual({
      model: "jev-latest",
      state: { a: 1 },
      questions: { next: NEXT, done: DONE },
    });
  });

  it("without a key it fails at once; HTTP errors and bad answers are errors", async () => {
    let calls = 0;
    const answering = (status: number, body: unknown): Jev =>
      createJev({
        apiKey: async () => "k",
        fetch: async () => {
          calls += 1;
          return new Response(JSON.stringify(body), { status });
        },
      });

    const keyless = createJev({
      apiKey: async () => null,
      fetch: async () => {
        calls += 1;
        return new Response("{}");
      },
    });
    expect(await keyless.ask({}, { done: DONE })).toEqual({ ok: false, error: JEV_NOT_SET_UP });
    expect(calls).toBe(0);

    const denied = await answering(401, { detail: "bad key" }).ask({}, { done: DONE });
    expect(denied).toEqual({ ok: false, error: 'HTTP 401: {"detail":"bad key"}' });
    const missing = await answering(200, { answers: {} }).ask({}, { done: DONE });
    expect(missing).toEqual({ ok: false, error: 'no valid answer to "done"' });
    const wrongType = await answering(200, {
      answers: { done: { type: "choice", choice: "x", probabilities: { x: 1 } } },
    }).ask({}, { done: DONE });
    expect(wrongType).toEqual({ ok: false, error: 'no valid answer to "done"' });
  });

  it("answers outside 0..1 are rejected", () => {
    expect(parseAnswer({ type: "noul", noul: 1.2 })).toBeNull();
    expect(parseAnswer({ type: "noul", noul: Number.NaN })).toBeNull();
    expect(parseAnswer({ type: "choice", choice: "a", probabilities: { a: -0.1 } })).toBeNull();
    expect(parseAnswer({ type: "noul", noul: 0.5 })).toEqual({ type: "noul", noul: 0.5 });
  });
});

describe("jev: the group router", () => {
  const answering = (value: Record<string, JevAnswer> | string): Jev => ({
    async ask() {
      return typeof value === "string" ? { ok: false, error: value } : { ok: true, value };
    },
  });
  const next = (probabilities: Record<string, number>): JevAnswer => ({
    type: "choice",
    choice: Object.keys(probabilities)[0] ?? "",
    probabilities,
  });
  const noul = (p: number): JevAnswer => ({ type: "noul", noul: p });
  const signal = new AbortController().signal;

  it("asks only who starts on the first pick; later, whether it's done or needs the user", () => {
    expect(Object.keys(routeQuestions(request(true)))).toEqual(["next"]);
    expect(Object.keys(routeQuestions(request(false)))).toEqual(["next", "done", "waiting"]);
    expect(routeQuestions(request(true)).next).toMatchObject({
      type: "choice",
      criteria: { b_00000001: "Chef: Cooks.", b_00000002: "Coach: Trains." },
    });
    expect(routeState(request(false))).toEqual({
      group: "Team",
      earlier: [{ from: "User", text: "hi" }],
      conversation: [{ from: "User", text: "Plan dinner" }],
    });
  });

  it("ranks the open members by probability and stops at 0.5 done or waiting", async () => {
    const route = (answers: Record<string, JevAnswer>, first = false) =>
      jevRouter(answering(answers), () => {})(request(first), signal);

    const going = await route({
      next: next({ b_00000001: 0.2, b_00000002: 0.7, b_gone: 0.1 }),
      done: noul(0.1),
      waiting: noul(0.49),
    });
    expect(going).toEqual({
      ranked: ["b_00000002", "b_00000001"],
      stop: false,
      note: "next 0.70, done 0.10, waiting 0.49",
    });
    expect(
      (await route({ next: next({ b_00000001: 1 }), done: noul(0.5), waiting: noul(0) }))?.stop,
    ).toBe(true);
    expect(
      (await route({ next: next({ b_00000001: 1 }), done: noul(0), waiting: noul(0.9) }))?.stop,
    ).toBe(true);
    // Why it stops: waiting on the user only when that is at least as likely as done.
    expect(
      (await route({ next: next({ b_00000001: 1 }), done: noul(0.6), waiting: noul(0.7) }))?.reason,
    ).toBe("waiting");
    expect(
      (await route({ next: next({ b_00000001: 1 }), done: noul(0.8), waiting: noul(0.7) }))?.reason,
    ).toBe("done");
    expect(
      (await route({ next: next({ b_00000001: 1 }), done: noul(0.5), waiting: noul(0.1) }))?.reason,
    ).toBe("done");
    // The first pick never stops the group.
    expect((await route({ next: next({ b_00000001: 1 }) }, true))?.stop).toBe(false);
  });

  it("no answer: null; a missing key is logged once, other failures every time", async () => {
    const lines: string[] = [];
    const keyless = jevRouter(answering(JEV_NOT_SET_UP), (m) => lines.push(m));
    expect(await keyless(request(true), signal)).toBeNull();
    expect(await keyless(request(false), signal)).toBeNull();
    const broken = jevRouter(answering("HTTP 500: oops"), (m) => lines.push(m));
    expect(await broken(request(false), signal)).toBeNull();
    expect(lines).toEqual([
      "[jev] no Typesafe key: groups route by relevance",
      "[jev] routing failed: HTTP 500: oops",
    ]);
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";
import type * as KleioAi from "@kleio/ai";
import type { StreamOptions } from "@kleio/ai";
import type { AuthStorage } from "./auth-storage.js";

const streamMock = vi.hoisted(() => vi.fn());
vi.mock("@kleio/ai", async (importOriginal) => ({
  ...(await importOriginal<typeof KleioAi>()),
  stream: streamMock,
}));

const {
  COMPLETE_DEFAULT_MAX_TOKENS,
  COMPLETE_DEFAULT_TIMEOUT_MS,
  CompletionTimeoutError,
  completeOnce,
  parseCompleteRequest,
} = await import("./one-shot-complete.js");

/** A StreamResult-shaped stand-in: awaitable, with a `response` promise. */
function fakeResult(response: Promise<unknown>) {
  return { response, then: response.then.bind(response) };
}

function reply(content: unknown) {
  return fakeResult(Promise.resolve({ message: { role: "assistant", content } }));
}

const auth = {
  resolveCredentials: vi.fn(async () => ({
    accessToken: "sk-local",
    baseUrl: "http://127.0.0.1:9/v1",
  })),
} as unknown as AuthStorage;

const base = {
  auth,
  provider: "local" as const,
  model: "local/fake/chat",
  prompt: "hello",
  maxTokens: 800,
  timeoutMs: 5_000,
};

beforeEach(() => {
  streamMock.mockReset();
});

describe("parseCompleteRequest", () => {
  it("applies defaults and keeps a non-blank system prompt", () => {
    expect(parseCompleteRequest({ model: "m", prompt: "p" })).toEqual({
      model: "m",
      prompt: "p",
      maxTokens: COMPLETE_DEFAULT_MAX_TOKENS,
      timeoutMs: COMPLETE_DEFAULT_TIMEOUT_MS,
    });
    expect(
      parseCompleteRequest({ model: "m", prompt: "p", system: "s", maxTokens: 4000 }),
    ).toMatchObject({ system: "s", maxTokens: 4000 });
    expect(parseCompleteRequest({ model: "m", prompt: "p", system: "  " })).not.toHaveProperty(
      "system",
    );
  });

  it.each([
    [null, "body must be a JSON object"],
    [[], "body must be a JSON object"],
    [{ prompt: "p" }, "model must be a non-empty string"],
    [{ model: " ", prompt: "p" }, "model must be a non-empty string"],
    [{ model: "m" }, "prompt must be a non-empty string"],
    [{ model: "m", prompt: "\n" }, "prompt must be a non-empty string"],
    [{ model: "m", prompt: "p", system: 1 }, "system must be a string"],
    [{ model: "m", prompt: "p", maxTokens: 0 }, "maxTokens must be an integer from 1 to 4000"],
    [{ model: "m", prompt: "p", maxTokens: 4001 }, "maxTokens must be an integer from 1 to 4000"],
    [{ model: "m", prompt: "p", maxTokens: 1.5 }, "maxTokens must be an integer from 1 to 4000"],
    [{ model: "m", prompt: "p", maxTokens: "9" }, "maxTokens must be an integer from 1 to 4000"],
    [
      { model: "m", prompt: "p", timeoutMs: 120_001 },
      "timeoutMs must be an integer from 1 to 120000",
    ],
    [{ model: "m", prompt: "p", timeoutMs: -1 }, "timeoutMs must be an integer from 1 to 120000"],
  ])("rejects %j", (body, error) => {
    expect(parseCompleteRequest(body)).toEqual({ error });
  });
});

describe("completeOnce", () => {
  it("makes one tool-less, thinking-off call with the stored credential", async () => {
    streamMock.mockReturnValue(
      reply([
        { type: "text", text: "Hi " },
        { type: "text", text: "!" },
      ]),
    );
    const text = await completeOnce({ ...base, system: "Be brief." });
    expect(text).toBe("Hi !");
    expect(auth.resolveCredentials).toHaveBeenCalledWith("local", { storageKeys: ["local"] });
    const opts = streamMock.mock.calls[0]![0] as StreamOptions;
    expect(opts).toMatchObject({
      provider: "local",
      model: "local/fake/chat",
      maxTokens: 800,
      apiKey: "sk-local",
      baseUrl: "http://127.0.0.1:9/v1",
      messages: [
        { role: "system", content: "Be brief." },
        { role: "user", content: "hello" },
      ],
    });
    expect(opts.tools).toBeUndefined();
    expect(opts.thinking).toBeUndefined();
    expect(opts.temperature).toBeUndefined();
  });

  it("omits the system message when none is given and accepts string content", async () => {
    streamMock.mockReturnValue(reply("plain"));
    expect(await completeOnce(base)).toBe("plain");
    const opts = streamMock.mock.calls[0]![0] as StreamOptions;
    expect(opts.messages).toEqual([{ role: "user", content: "hello" }]);
  });

  it("propagates provider failures", async () => {
    streamMock.mockReturnValue(fakeResult(Promise.reject(new Error("401 bad key"))));
    await expect(completeOnce(base)).rejects.toThrow("401 bad key");
  });

  it("aborts the call and throws CompletionTimeoutError at the deadline", async () => {
    let signal: AbortSignal | undefined;
    streamMock.mockImplementation((opts: StreamOptions) => {
      signal = opts.signal;
      // A provider that ignores the abort entirely still can't outlive the deadline.
      return fakeResult(new Promise(() => {}));
    });
    const err = await completeOnce({ ...base, timeoutMs: 30 }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CompletionTimeoutError);
    expect((err as Error).message).toBe("completion timed out after 30ms");
    expect(signal?.aborted).toBe(true);
  });

  it("aborts the provider call when the caller's signal fires", async () => {
    const caller = new AbortController();
    let signal: AbortSignal | undefined;
    streamMock.mockImplementation((opts: StreamOptions) => {
      signal = opts.signal;
      return fakeResult(
        new Promise((_, reject) =>
          opts.signal!.addEventListener("abort", () => reject(new Error("aborted"))),
        ),
      );
    });
    const pending = completeOnce({ ...base, signal: caller.signal });
    await vi.waitFor(() => expect(signal).toBeDefined());
    caller.abort();
    await expect(pending).rejects.toThrow("aborted");
    expect(signal?.aborted).toBe(true);
  });
});

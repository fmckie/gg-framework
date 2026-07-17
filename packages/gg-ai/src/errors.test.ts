import { describe, expect, it } from "vitest";
import {
  GGAIError,
  ProviderError,
  VideoUnsupportedError,
  formatError,
  formatErrorForDisplay,
  isUsageLimitError,
  readHeader,
} from "./errors.js";

describe("isUsageLimitError", () => {
  it("matches the canonical usage-limit message", () => {
    expect(isUsageLimitError(new ProviderError("anthropic", "Claude usage limit reached"))).toBe(
      true,
    );
  });

  it("does not match a transient rate-limit error", () => {
    expect(
      isUsageLimitError(
        new ProviderError("anthropic", "rate_limit_error: Rate limited.", { statusCode: 429 }),
      ),
    ).toBe(false);
  });

  it("returns false for non-Error values", () => {
    expect(isUsageLimitError("Claude usage limit reached")).toBe(false);
  });
});

describe("formatError usage limit", () => {
  it("produces a clear usage-finished message with reset time", () => {
    const resetsAt = Math.floor(Date.now() / 1000) + 3600;
    const formatted = formatError(
      new ProviderError("anthropic", "Claude usage limit reached", {
        statusCode: 429,
        resetsAt,
      }),
    );
    expect(formatted.headline).toBe("Anthropic usage limit reached.");
    expect(formatted.message).toContain("Your Anthropic usage is finished.");
    expect(formatted.message).toContain("It resets at");
    expect(formatted.guidance).toContain("Try again once it's back.");
    expect(formatted.resetsAt).toBe(resetsAt);
  });

  it("omits the reset clause when no reset time is known", () => {
    const formatted = formatError(
      new ProviderError("anthropic", "Claude usage limit reached", { statusCode: 429 }),
    );
    expect(formatted.headline).toBe("Anthropic usage limit reached.");
    expect(formatted.message).toBe("Your Anthropic usage is finished.");
    expect(formatted.resetsAt).toBeUndefined();
  });
});

describe("formatError Mythos access", () => {
  it("explains invite-only access for a Mythos not_found_error", () => {
    const formatted = formatError(
      new ProviderError("anthropic", "not_found_error: model: claude-mythos-5", {
        statusCode: 404,
      }),
    );
    expect(formatted.headline).toBe("Claude Mythos 5 is invitation-only.");
    expect(formatted.message).toContain("Project Glasswing");
    expect(formatted.guidance).toContain(
      "platform.claude.com/docs/en/about-claude/models/overview",
    );
    expect(formatted.guidance).toContain("claude-fable-5");
  });

  it("does not hijack not_found errors for other models", () => {
    const formatted = formatError(
      new ProviderError("anthropic", "not_found_error: model: claude-opus-9", {
        statusCode: 404,
      }),
    );
    expect(formatted.headline).toBe("Anthropic returned an error.");
  });
});

describe("VideoUnsupportedError", () => {
  it("formats as a clean capability error naming video-capable models", () => {
    const f = formatError(new VideoUnsupportedError());
    expect(f.source).toBe("capability");
    expect(f.headline).toBe("This model can't analyze video.");
    expect(f.guidance).toContain("Kimi");
    expect(f.guidance).toContain("Gemini");
    expect(f.guidance).toContain("MiniMax");
    expect(f.guidance).toContain("MiMo");
    expect(f.guidance).toContain("/model");
  });

  it("renders headline + guidance only (no bug-report framing)", () => {
    const out = formatErrorForDisplay(new VideoUnsupportedError());
    expect(out).toContain("This model can't analyze video.");
    expect(out).not.toContain("application bug");
  });
});

describe("formatErrorForDisplay", () => {
  it("renders an Anthropic 529 overloaded error as headline + message + guidance", () => {
    const out = formatErrorForDisplay(
      new ProviderError("anthropic", "overloaded_error: Overloaded", { statusCode: 529 }),
    );
    expect(out).toBe(
      [
        "Anthropic returned an error.",
        "  overloaded_error: Overloaded",
        "  \u2192 Anthropic's servers are overloaded right now. Retry in a moment. The error came from Anthropic.",
      ].join("\n"),
    );
  });

  it("renders an OpenAI 500 server_error pointing at the status page", () => {
    const out = formatErrorForDisplay(
      new ProviderError("openai", "server_error: something broke", { statusCode: 500 }),
    );
    expect(out).toBe(
      [
        "OpenAI returned an error.",
        "  server_error: something broke",
        "  \u2192 The error came from OpenAI. Retry \u2014 if it keeps happening, check status.openai.com.",
      ].join("\n"),
    );
  });

  it("prefers an explicit provider hint over the inferred guidance", () => {
    const out = formatErrorForDisplay(
      new ProviderError("openai", "This model is not available.", {
        statusCode: 404,
        hint: "Run /model and choose a listed model.",
      }),
    );
    expect(out).toBe(
      [
        "OpenAI returned an error.",
        "  This model is not available.",
        "  \u2192 Run /model and choose a listed model.",
      ].join("\n"),
    );
  });

  it("strips a legacy [provider] prefix from the message body", () => {
    const out = formatErrorForDisplay(
      new ProviderError("gemini", "[gemini] quota exceeded", { statusCode: 429 }),
    );
    expect(out).toBe(
      [
        "Gemini returned an error.",
        "  quota exceeded",
        "  \u2192 Your Gemini account has a billing or quota issue \u2014 check your balance. The error came from Gemini.",
      ].join("\n"),
    );
  });

  it("classifies a network GGAIError without application-bug framing", () => {
    const out = formatErrorForDisplay(new GGAIError("fetch failed", { source: "network" }));
    expect(out).toBe(
      [
        "Network error \u2014 couldn't reach the provider.",
        "  fetch failed",
        "  \u2192 Check your internet connection, then retry shortly.",
      ].join("\n"),
    );
  });

  it("uses product-neutral application-bug copy for unknown errors", () => {
    const out = formatErrorForDisplay(new Error("Cannot read property 'foo' of undefined"));
    expect(out).toBe(
      [
        "The application hit an unexpected error.",
        "  Cannot read property 'foo' of undefined",
        "  \u2192 This looks like an application bug \u2014 please report it to the developer.",
      ].join("\n"),
    );
  });

  it("applies an application profile without changing the machine source", () => {
    const display = {
      productName: "Kleio Coder",
      loginCommand: "kleio-coder login",
      bugReportUrl: "https://github.com/fmckie/gg-framework/issues",
    };
    const formatted = formatError(new Error("boom"), display);
    expect(formatted).toMatchObject({
      source: "ggcoder",
      headline: "Kleio Coder hit an unexpected error.",
      guidance:
        "This looks like a Kleio Coder bug \u2014 please report it at https://github.com/fmckie/gg-framework/issues.",
    });
  });

  it("uses the profiled login command and provider attribution", () => {
    const display = {
      productName: "Kleio Manager",
      loginCommand: "kleio-coder login",
    };
    expect(
      formatError(new ProviderError("openai", "unauthorized", { statusCode: 401 }), display)
        .guidance,
    ).toBe(
      "Authentication failed with OpenAI. Run `kleio-coder login` to refresh your credentials.",
    );
    expect(
      formatError(new ProviderError("openai", "server_error", { statusCode: 500 }), display)
        .guidance,
    ).toContain("The error came from OpenAI, not Kleio Manager.");
  });
});

describe("readHeader", () => {
  it("reads from a web Headers object", () => {
    const headers = new Headers({ "x-request-id": "req_123" });
    expect(readHeader(headers, "x-request-id")).toBe("req_123");
  });

  it("falls back to the lowercased name on a plain record", () => {
    // Preserves the original anthropic getter contract: tries the exact name,
    // then the lowercased name — so a capitalized lookup finds a lowercase key.
    expect(readHeader({ "x-request-id": "req_456" }, "X-Request-Id")).toBe("req_456");
  });

  it("returns the first present header among several candidates", () => {
    const headers = new Headers({ "openai-request-id": "oai_789" });
    expect(readHeader(headers, "x-request-id", "openai-request-id", "x-oai-request-id")).toBe(
      "oai_789",
    );
  });

  it("returns undefined when no candidate is present", () => {
    expect(readHeader(new Headers(), "x-request-id")).toBeUndefined();
  });

  it("returns undefined for nullish or non-object headers", () => {
    expect(readHeader(undefined, "x-request-id")).toBeUndefined();
    expect(readHeader(null, "x-request-id")).toBeUndefined();
  });
});

/**
 * One-shot completion for the daemon's `POST /complete`: a single stateless
 * LLM call (no agent loop, no tools, thinking off) that returns the reply
 * text. Not session-scoped — the caller has already resolved the model.
 */
import { stream, type Message, type Provider, type TextContent } from "@kleio/ai";
import type { AuthStorage } from "./auth-storage.js";
import { getClaudeCliUserAgent } from "./claude-code-version.js";
import { getAuthStorageKeys } from "./model-registry.js";

export const COMPLETE_DEFAULT_MAX_TOKENS = 1000;
export const COMPLETE_MAX_MAX_TOKENS = 4000;
export const COMPLETE_DEFAULT_TIMEOUT_MS = 60_000;
export const COMPLETE_MAX_TIMEOUT_MS = 120_000;

export interface CompleteRequest {
  model: string;
  system?: string;
  prompt: string;
  maxTokens: number;
  timeoutMs: number;
}

function boundedInt(
  value: unknown,
  name: string,
  fallback: number,
  max: number,
): number | { error: string } {
  if (value === undefined) return fallback;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > max) {
    return { error: `${name} must be an integer from 1 to ${max}` };
  }
  return value;
}

/** Validate a `POST /complete` body; `{ error }` is the 400 message. */
export function parseCompleteRequest(body: unknown): CompleteRequest | { error: string } {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { error: "body must be a JSON object" };
  }
  const b = body as Record<string, unknown>;
  if (typeof b.model !== "string" || !b.model.trim()) {
    return { error: "model must be a non-empty string" };
  }
  if (typeof b.prompt !== "string" || !b.prompt.trim()) {
    return { error: "prompt must be a non-empty string" };
  }
  if (b.system !== undefined && typeof b.system !== "string") {
    return { error: "system must be a string" };
  }
  const maxTokens = boundedInt(
    b.maxTokens,
    "maxTokens",
    COMPLETE_DEFAULT_MAX_TOKENS,
    COMPLETE_MAX_MAX_TOKENS,
  );
  if (typeof maxTokens !== "number") return maxTokens;
  const timeoutMs = boundedInt(
    b.timeoutMs,
    "timeoutMs",
    COMPLETE_DEFAULT_TIMEOUT_MS,
    COMPLETE_MAX_TIMEOUT_MS,
  );
  if (typeof timeoutMs !== "number") return timeoutMs;
  return {
    model: b.model,
    ...(b.system?.trim() ? { system: b.system } : {}),
    prompt: b.prompt,
    maxTokens,
    timeoutMs,
  };
}

/** The completion hit its `timeoutMs` deadline (the provider call was aborted). */
export class CompletionTimeoutError extends Error {
  constructor(readonly timeoutMs: number) {
    super(`completion timed out after ${timeoutMs}ms`);
    this.name = "CompletionTimeoutError";
  }
}

/**
 * Run one completion on `provider`/`model` with credentials from the auth
 * store (for `local`, that credential carries the endpoint's baseUrl).
 * Credential resolution and the provider call share the `timeoutMs` deadline;
 * on expiry the call is aborted and CompletionTimeoutError is thrown. An
 * aborted `signal` (e.g. the HTTP client went away) aborts the call too.
 */
export async function completeOnce(opts: {
  auth: AuthStorage;
  provider: Provider;
  model: string;
  system?: string;
  prompt: string;
  maxTokens: number;
  timeoutMs: number;
  signal?: AbortSignal;
}): Promise<string> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  opts.signal?.addEventListener("abort", abort, { once: true });
  let timer: NodeJS.Timeout | undefined;
  let timedOut = false;
  // Rejects at the deadline even if a provider ignores the abort signal.
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
      reject(new CompletionTimeoutError(opts.timeoutMs));
    }, opts.timeoutMs);
  });

  const run = async (): Promise<string> => {
    const creds = await opts.auth.resolveCredentials(opts.provider, {
      storageKeys: getAuthStorageKeys(opts.provider, opts.model),
    });
    const messages: Message[] = [
      ...(opts.system ? [{ role: "system" as const, content: opts.system }] : []),
      { role: "user", content: opts.prompt },
    ];
    const result = stream({
      provider: opts.provider,
      model: opts.model,
      messages,
      maxTokens: opts.maxTokens,
      // Thinking off and no tools: a plain text reply. No temperature — some
      // models (e.g. OpenAI reasoning models) reject the parameter outright.
      apiKey: creds.accessToken,
      baseUrl: creds.baseUrl,
      accountId: creds.accountId,
      projectId: creds.projectId,
      userAgent: opts.provider === "anthropic" ? await getClaudeCliUserAgent() : undefined,
      signal: controller.signal,
    });
    // Attach a no-op catch immediately so a rejection in the microtask gap
    // before our await isn't reported as unhandled.
    result.response.catch(() => {});
    const { content } = (await result).message;
    return typeof content === "string"
      ? content
      : content
          .filter((c): c is TextContent => c.type === "text")
          .map((c) => c.text)
          .join("");
  };

  try {
    return await Promise.race([run(), deadline]);
  } catch (err) {
    throw timedOut ? new CompletionTimeoutError(opts.timeoutMs) : err;
  } finally {
    clearTimeout(timer);
    opts.signal?.removeEventListener("abort", abort);
  }
}

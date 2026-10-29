---
"@kleio/ai": patch
---

Fixes imported selectively from upstream engine releases after 5.66.2. The engine base stays 5.66.2; `UPSTREAM.md` lists the upstream commits.

- Provider requests no longer fail at Node's 300-second fetch limit. The Anthropic, OpenAI-compatible, Codex and Gemini Code Assist transports now use a provider fetch with a 45-minute transport backstop. When Node's environment proxy is on (`NODE_USE_ENV_PROXY=1` or `--use-env-proxy`), that fetch still goes through `HTTP_PROXY`/`HTTPS_PROXY` and honours `NO_PROXY`.
- `stream()` takes an `onTransportActivity` callback, fired for every SSE chunk on the Anthropic transport, so the pings Anthropic sends during long silent thinking count as activity.
- OpenAI and Codex models that reason without showing it now yield keepalive events flagged `reasoning: true`.
- New `ResponseStalledError`, which `formatError` reports as a stalled response rather than a connection failure.
- Codex (ChatGPT) replies that end without a terminal event are retried. A reply the server stopped early reports `max_tokens`, `refusal` or `error` instead of a finished turn, and a completed reply holding an unfinished tool call is refused.
- With the 1-hour Anthropic cache TTL, tool-loop turns are written at the 5-minute rate and user messages at 1 hour, which cuts cache-write cost.
- xAI requests send `x-grok-conv-id`, so Grok reuses its prompt cache.
- Redaction now hides URL passwords that contain `@` and passwords with no username (`redis://:secret@host`).
- New dependency: `undici` 7.29.1.

---
"@kleio/agent": patch
---

Fixes imported selectively from upstream engine releases after 5.66.2. The engine base stays 5.66.2; `UPSTREAM.md` lists the upstream commits.

- `AgentOptions.fetch` is passed through to `stream()`, so a host's own fetch reaches the provider transport.
- Long thinking turns are no longer killed as stalled. Transport activity, including Anthropic's pings, re-arms the idle timer, and hidden-reasoning keepalives get the thinking budget. A live stream is ended only by the thinking hard cap, now 30 minutes; non-streaming fallbacks keep 15. xAI always gets the silent-reasoning budget for its first event.
- When stall retries run out after the provider had answered, the run fails with `ResponseStalledError` instead of a connection error. A stall that killed a long open tool call asks the model once for smaller pieces.
- Cloudflare 520–524 errors from a provider are retried, and parallel tool calls that fail with the same invalid arguments count as one strike per response.

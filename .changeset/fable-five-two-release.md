---
"@kleio/ai": minor
"@kleio/core": minor
"@kleio/coder": minor
"@kleio/manager": minor
---

Add Claude Fable 5.2 (`claude-fable-5-2`, released 2026-11-09) to the model registry: 1M context, 128k output, image input, $8/$40 MTok (Fable 5.1 was $10/$50), cache reads $0.20/MTok. Adaptive thinking is always on, steered by all five effort levels (low, medium, high, xhigh, max); new sessions start at `high`, Anthropic's default, instead of `max`. Like 5.1 it rejects forced tool use (`tool_choice` `any`/`tool`) with a 400; gg-coder only ever sends `auto`/`none`, so no call path changes.

It replaces Fable 5.1, which is retired from the registry, the model picker and the login screen's model list. A session still pinned to `claude-fable-5-1` falls back to the provider default on next start.

---
"@kleio/coder": patch
---

The app sidecar's keep-awake hold now has a ceiling: a hold older than 6 hours lets go of the OS idle-sleep assertion and logs it, so a stuck run can't keep a laptop awake indefinitely. Each hold (a run, a Ken reply, a window's background sub-agents) has its own ceiling, and a new run after the ceiling holds again. `GG_APP_KEEP_AWAKE_MAX_MS` overrides the ceiling in milliseconds. `GET /keep-awake` now answers `holding` (whether the assertion is held right now) alongside `enabled`.

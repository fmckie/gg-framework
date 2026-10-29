---
"@kleio/core": patch
---

Fixes imported selectively from upstream engine releases after 5.66.2. The engine base stays 5.66.2; `UPSTREAM.md` lists the upstream commits.

- The file logger budgets bytes per process. A long-running daemon that starts next to a nearly full shared log no longer inherits its size, hits the cap within minutes and stops logging; when the shared file fills, it rotates to `.1` and keeps logging.
- A rejected token refresh re-reads the stored credentials before deleting them, so it no longer wipes a newer login another process saved meanwhile.

---
"@kleio/coder": patch
---

Fixes imported selectively from upstream engine releases after 5.66.2. The engine base stays 5.66.2; `UPSTREAM.md` lists the upstream commits.

- `write` refuses to overwrite a file the model has only partly read (a read cut short by `offset`/`limit` or the size cap), so lines it never saw are not silently dropped. Paging through an unchanged file counts as reading all of it.
- `bash` no longer hangs until its timeout when a command leaves a process running (`cmd &`, `nohup cmd`) that holds its output pipes.
- Invisible Unicode is stripped from AGENTS.md, CLAUDE.md and `.gg` skills, agents and commands before they reach the model.
- `@anthropic-ai/sandbox-runtime` 0.0.78.
- The project picker no longer lists dot folders, tool folders, or folders whose sessions never recorded a message.
- Ken's autopilot review lists every file the turn changed, keeps the corpus warning on its verdict line, and reviews the transcript instead of answering a user.
- Compaction no longer triggers early after pruning: the freed tokens are subtracted from the provider's count instead of switching to a skewed character estimate. Each provider's trigger now follows cited evidence instead of a flat 400K cap, and Gemini 3.1 Pro compacts at 170K, under its 200K price line.
- A run that compacted and then failed or was aborted keeps its post-compaction messages, so the next prompt no longer replays a history the provider can reject.
- Background commands are stopped before any asynchronous teardown, through the new `AgentSession.stopBackgroundProcesses()`, so they no longer outlive the app.
- The Environment section, including the working directory, moved behind the system prompt's uncached marker, so every checkout and worktree of a project shares one cached system block.

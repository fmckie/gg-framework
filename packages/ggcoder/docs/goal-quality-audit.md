# Goal Quality Audit: compaction, responsiveness, prompt quality

Date: 2026-05-22  
Scope: source-backed baseline audit for GG Coder compaction strategies, response-path performance/responsiveness, and system-prompt quality. This artifact intentionally avoids editing the already-modified implementation files shown by `git status`.

## Evidence sources

| Source                                         | Citation                                                                                               | What it establishes                                                                                                                                                                                      |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GG Coder compactor                             | `packages/ggcoder/src/core/compaction/compactor.ts:21-45`, `:58-79`, `:92-125`, `:253-298`, `:529-795` | Current compaction prompt, reserve thresholds, message preparation, LLM summarization, fallback behavior, final message repair.                                                                          |
| GG Coder prompt                                | `packages/ggcoder/src/system-prompt.ts:21-39`, `:69-76`, `:126-132`, `:150-206`                        | Talk brevity rules, work rules, project-context precedence, research/Goal guidance, prompt section order.                                                                                                |
| GG Coder CLI/interactive compaction call sites | `packages/ggcoder/src/cli.ts:737-747`, `packages/ggcoder/src/interactive.ts:103-113`                   | Compaction is checked on the response path before generation and is abort-wired with SIGINT.                                                                                                             |
| Claude Code memory docs                        | `web_fetch https://code.claude.com/docs/en/memory`                                                     | CLAUDE.md is context, not enforced config; concise/specific instructions improve adherence; target under 200 lines; load order from broader to more specific; local/project instructions appended later. |
| Claude Code settings docs                      | `web_fetch https://code.claude.com/docs/en/settings`                                                   | Settings precedence is explicit: managed > command-line > local > project > user; some prompt-affecting settings only apply after prompt rebuild/restart.                                                |
| Curated agent refs                             | `referenceSources(domain=agents, category=coding-agents\|agent-cli, stack=TypeScript)`                 | Gemini CLI, OpenCode, Cline, Continue, and Claude Code Action are relevant public coding-agent baselines.                                                                                                |
| Gemini CLI source search                       | `searchCode repo=google-gemini/gemini-cli query="tokenBudget"` and `query="reserve"`                   | Gemini exposes tool-output summarization token budgets and uses reserve/cleanup concepts; useful as baseline that token-budgeted output handling is normal.                                              |
| OpenCode source search                         | `searchCode repo=anomalyco/opencode query="session.compact"`                                           | OpenCode exposes a session compact operation, confirming manual/session-level compaction is a common agent capability.                                                                                   |

## Findings

### 1. Compaction trigger strategy is source-backed and should be kept

- Source baseline: modern agent CLIs expose compaction or token-budgeted summarization (`OpenCode` session compact endpoint; `Gemini CLI` `SummarizeToolOutputSettings.tokenBudget`).
- Observed GG Coder behavior: `shouldCompact()` uses a conservative `min(percentageLimit, contextWindow - reserveTokens)` trigger with a 16,384-token default reserve and a 5,000-token overhead-aware max-token reserve helper (`compactor.ts:58-79`, `:92-125`).
- Confidence: 95%.
- Recommendation: **Adopt/keep.** The reserve-based strategy is appropriate and better than a pure percentage threshold for models with large requested output caps.
- Action status: no implementation task needed.

### 2. Compaction preserves recent context and repairs provider-sensitive message shape

- Source baseline: provider APIs commonly reject malformed tool-call/tool-result pairing; Claude docs emphasize prompt/context inputs are context, not config, so preserving concise, relevant state matters.
- Observed GG Coder behavior: `findRecentCutPoint()` preserves system message and a recent tail; `prepareMessagesForSummary()` strips thinking blocks, converts tool calls/results to text, truncates large content, and merges consecutive same-role messages; final `repairToolPairing()` removes orphan tool calls/results before returning compacted messages (`compactor.ts:127-177`, `:253-298`, `:374-456`, `:725-795`).
- Confidence: 96%.
- Recommendation: **Adopt/keep.** The shape-repair and conversion strategy directly targets known provider failure modes while preserving operational continuity.
- Action status: no implementation task needed.

### 3. Compaction can still block responsiveness because summary LLM calls have retries but no local timeout

- Source baseline: response-path compaction is invoked before continuing generation (`cli.ts:737-747`, `interactive.ts:103-113`); responsive CLIs need bounded pre-response work. Claude settings docs also distinguish settings that apply live vs only on restart, reinforcing that prompt/response-path behavior should be predictable.
- Observed GG Coder behavior: `compact()` calls `stream(...).response` up to three total attempts and relies on the passed abort signal; there is no compaction-specific timeout or fallback deadline before using `buildFallbackSummary()` (`compactor.ts:655-723`). If the provider stalls without aborting, user response can stall during pre-generation compaction.
- Confidence: 92%.
- Recommendation: **Adopt change.** Add a local/free timeout or deadline around each summary attempt or the overall compaction phase, then fall back to extractive summary. Preserve SIGINT abort behavior.
- Action status: implementation task added below.

### 4. System prompt shape aligns with concise/context-aware guidance

- Source baseline: Claude memory docs recommend specific, concise, well-structured instructions and target under 200 lines for CLAUDE.md-like persistent context; Claude settings docs publish explicit precedence rules.
- Observed GG Coder behavior: `renderTalkSection()` enforces short between-tool and final replies (`system-prompt.ts:21-27`); `renderWorkSection()` includes preserve-user-work, read-before-edit, verify, and precedence rules (`:30-40`); `buildSystemPrompt()` orders identity/talk/work/research/tools/project context/environment/date (`:150-206`). Project context section is marked highest precedence (`:126-128`).
- Confidence: 94%.
- Recommendation: **Adopt/keep.** Prompt is compact and structured. The recent modified diffs strengthen Goal-specific proof language without bloating the base prompt.
- Action status: no implementation task needed.

### 5. Prompt precedence language may be internally confusing but is not clearly broken

- Source baseline: Claude docs load broader instructions before narrower ones so more local/project instructions appear later; settings docs define explicit priority order. GG Coder says project context files override default guidance, while `renderWorkSection()` says `project context files → edited file/module patterns → Language Style Packs → this prompt` (`system-prompt.ts:37-39`).
- Observed GG Coder behavior: actual rendering places default sections before project context and language packs, so later sections can influence model attention, but the textual precedence rule says project context has priority.
- Confidence: 90%.
- Recommendation: **Reject immediate change.** There is no direct failing evidence. If users report precedence confusion, consider making the precedence wording match the rendered order more explicitly: project/user context overrides defaults; more specific file/module patterns override broad style guidance unless project context says otherwise.
- Action status: no task now.

## Recommended implementation tasks

1. Bound compaction summarization latency with timeout/deadline fallback.

## Lightweight artifact check

- Created this tracked Markdown artifact at `packages/ggcoder/docs/goal-quality-audit.md`.
- No implementation files were changed by this audit worker; existing modified files were inspected and preserved.

# Kleio Manager

<p align="center">
  <strong>One chat. Many Kleio Coder workers. One manager coordinating the room.</strong>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@kleio/manager"><img src="https://img.shields.io/npm/v/@kleio/manager?style=for-the-badge" alt="npm version"></a>
  <a href="../../LICENSE"><img src="https://img.shields.io/badge/License-MIT-blue.svg?style=for-the-badge" alt="MIT License"></a>
  <a href="https://github.com/fmckie/gg-framework/tree/main/packages/gg-boss"><img src="https://img.shields.io/badge/Source-GitHub-181717?style=for-the-badge&logo=github&logoColor=white" alt="Source on GitHub"></a>
</p>

You talk to Kleio Manager. It drives one worker per project in parallel. Dispatch work, watch workers finish, keep a backlog, and swap models on the fly—all from one terminal.

Built on [`@kleio/coder`](../ggcoder/README.md), [`@kleio/agent`](../gg-agent/README.md), and [`@kleio/ai`](../gg-ai/README.md). Part of the [Kleio Framework](../../README.md) monorepo.

---

## 🚀 Run It

```bash
# Sign in once with Kleio Coder; Kleio Manager reuses the same auth
npm i -g @kleio/coder
kleio-coder login

# Install Kleio Manager
npm i -g @kleio/manager

# Pick projects with an interactive history scanner
kleio-manager link

# Start the manager
kleio-manager
```

Already linked? `kleio-manager continue` resumes the most recent session. `kleio-manager --resume <id>` resumes a specific one.

---

## Command compatibility

`ggboss` remains a compatibility alias for `kleio-manager`, and `ggcoder` remains a compatibility alias for `kleio-coder`. The legacy `/model-boss` command and `--boss-model` flag also remain accepted beside `/model-manager` and `--manager-model`. Existing scripts can continue to use the legacy names; new documentation and automation should use the Kleio names. Both command generations use the same `.gg` credentials and sessions, including Manager state under `~/.gg/boss/`.

---

## 🪄 How it works

You type one prompt. Kleio Manager decides which workers to dispatch, in parallel or serial, with `prompt_worker` (fire-and-forget) or by adding to the task plan and calling `dispatch_pending`. Each worker is a full Kleio Coder agent—read, write, edit, bash, grep, find, ls, web fetch, and sub-agents—running in its own project directory.

When a worker finishes, you get a tight summary back: **Changed**, **Skipped**, **Verified**, **Notes**, and a single-letter **Status** (`DONE` / `UNVERIFIED` / `PARTIAL` / `BLOCKED` / `INFO`). Kleio Manager cross-checks that summary against the worker's actual tool calls, then reports back or re-prompts the worker to verify, finish, or unblock.

A few things make it feel like one conversation instead of N:

- **Live worker state** is appended to every event the manager receives, so it cannot forget that "B is still working" while reading "A finished."
- **Auto-chain.** If the manager leaves a project parked while pending tasks remain, the orchestrator dispatches the next task and reports the change.
- **Auto-compact.** When the manager's context crosses 80%, it compacts and starts a fresh session file so `kleio-manager continue` resumes the trimmed history.
- **Crash-resistant.** Six workers in one process cannot take the manager down. Uncaught throws and unhandled rejections are logged to `~/.gg/boss/debug.log`, and the run loop continues.
- **Audio chimes.** A done sound plays when each worker finishes, followed by an all-clear chime when every worker is idle and the queue is empty.

---

## 🎛 Models

Manager and workers run on **different models, on purpose**. Use a strong reasoning model (Opus, GPT-5) for Kleio Manager and a fast, inexpensive model (Sonnet, Haiku) for the workers—or whatever combination fits the work.

Defaults are `claude-opus-4-8` for the manager and `claude-sonnet-4-6` for the workers. Anthropic, OpenAI, GLM, and Moonshot are all supported—anything Kleio Coder supports. Swap mid-session with `/model-manager` and `/model-workers`; your choice persists across restarts.

```bash
kleio-manager --manager-model claude-opus-4-8 --worker-model claude-sonnet-4-6
kleio-manager --project ../api --project ../web   # Explicit project list
```

---

## ⌨️ Keybindings

| Key                         | What it does                                                          |
| --------------------------- | --------------------------------------------------------------------- |
| <kbd>Tab</kbd>              | Cycle the project scope pill (All / per-project) on your next message |
| <kbd>Shift+Tab</kbd>        | Cycle the manager's thinking level (Anthropic/OpenAI tiers, then off) |
| <kbd>Esc</kbd>              | Interrupt the manager mid-turn (workers keep running)                 |
| <kbd>Ctrl+T</kbd>           | Open the Tasks pane                                                   |
| <kbd>Ctrl+C</kbd> ×2        | Exit Kleio Manager                                                    |
| <kbd>↑</kbd> / <kbd>↓</kbd> | Recall previous prompts (when input is empty)                         |
| <kbd>Enter</kbd>            | Send · <kbd>Shift+Enter</kbd> newline · `/` opens the slash menu      |

Inside the **Tasks pane** (<kbd>Ctrl+T</kbd>):

| Key                                                          | What it does                                          |
| ------------------------------------------------------------ | ----------------------------------------------------- |
| <kbd>↑</kbd> / <kbd>↓</kbd> (or <kbd>k</kbd> / <kbd>j</kbd>) | Navigate tasks                                        |
| <kbd>Enter</kbd>                                             | Dispatch the selected task to its worker              |
| <kbd>r</kbd>                                                 | Run all pending and blocked tasks across idle workers |
| <kbd>d</kbd>                                                 | Delete the selected task                              |
| <kbd>Esc</kbd>                                               | Close the pane                                        |

---

## 💬 Slash commands

| Command                 | What it does                                        |
| ----------------------- | --------------------------------------------------- |
| `/help` (`/?`)          | Show all commands and keybindings                   |
| `/model-manager`        | Switch the manager's model                          |
| `/model-workers`        | Switch every worker's model                         |
| `/compact`              | Compact the manager's context now                   |
| `/clear`                | Clear chat history and terminal                     |
| `/radio`                | Stream a free internet radio station while you work |
| `/quit` (`/q`, `/exit`) | Exit Kleio Manager                                  |

---

## 📋 The task plan

Kleio Manager is more than a dispatcher: it keeps a persistent backlog for tracked, reviewable, resumable work.

- The manager adds tasks via `add_task(project, title, description, fresh?)`.
- Tasks live in `~/.gg/boss/plan.json` and survive restarts.
- Press <kbd>Ctrl+T</kbd> at any time to see the plan, dispatch an item, or delete it.
- Worker self-reported status (`DONE` / `UNVERIFIED` / `PARTIAL` / `BLOCKED` / `INFO`) updates the task automatically, and the manager can override it after cross-checking.
- When a project goes idle with pending work in the plan, **auto-chain** picks up the next task without waiting for the manager to remember it.

Direct dispatch (`prompt_worker`) is for one-shot work. The plan is for batches you want to curate, review, and resume.

---

## 📻 Radio

`/radio` streams long-running, royalty-free internet radio while you work — SomaFM Groove Salad, Drone Zone, Radio Paradise Mellow Mix, lofi beats. Pick a station or `Off`. Requires one of `mpv` (recommended), `ffplay`, `mpg123`, or `vlc/cvlc` on your `PATH`.

---

## 🗂 Project discovery

`kleio-manager link` is interactive. It scans:

- `~/.gg/sessions/`—your existing **Kleio Coder** projects
- `~/.claude/projects/`—your **Claude Code** projects (working directories are extracted from the JSONL events rather than the lossy directory-name encoding)
- `~/.codex/sessions/`—your **Codex** projects (working directories come from session metadata)

Projects are sorted most-recent first. Pick a few, save the list, and Kleio Manager starts a worker for each one.

---

## 🛟 Auto-update

On every launch, Kleio Manager applies an update queued by the previous run (effective on the next launch) and schedules a fresh registry check in the background. No prompts or interruption—you stay current.

---

## Support

- [Source](https://github.com/fmckie/gg-framework/tree/main/packages/gg-boss)
- [Issues](https://github.com/fmckie/gg-framework/issues)
- [Fork lineage and upstream policy](../../UPSTREAM.md)

---

## 📄 License

MIT

---

<p align="center">
  <strong>Talk to the manager. The workers do the rest.</strong>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@kleio/manager"><img src="https://img.shields.io/badge/Install-npm%20i%20--g%20%40kleio%2Fmanager-blue?style=for-the-badge" alt="Install"></a>
</p>

# gg-pixel — Spec (v1, draft)

Universal error tracking optimized for autonomous coding agents, not human dashboards.

## Vision

Drop a "pixel" SDK into any project (web app, CLI, server, eventually mobile). Every error — uncaught crash, unhandled rejection, `console.error`, manual report — phones home to a central backend. A web dashboard shows everything live across every project. A global `kleio-coder pixel` TUI pulls open errors and runs autonomous fix sessions, one per error, in the right project directory.

The key shift vs. Sentry/Bugsnag: **the primary consumer is a coding agent, not a human.** Payloads, schemas, and APIs are designed for that.

---

## Architecture (4 components)

1. **gg-pixel SDK** — drop-in library per runtime. Captures errors, posts to ingest.
2. **Ingest backend** — Cloudflare Workers + D1 (free tier). Accepts events, stores in SQLite-shaped DB, exposes management API + SSE stream.
3. **Web dashboard** — real-time error feed across all projects. Lightweight; not the primary surface.
4. **`kleio-coder pixel`** — global TUI fix-queue runner. Reuses the existing Tasks pane engine. Spawns one agent session per error.

---

## Data model

### Wire format (SDK → backend)

```jsonc
{
  "event_id": "uuid4 — unique per occurrence (used for idempotency)",
  "project_key": "pk_live_abc123",
  "fingerprint": "sha256(type + normalized_top_frame) — stable across recurrences",
  "type": "TypeError",
  "message": "Cannot read properties of undefined (reading 'name')",
  "stack": [
    {
      "file": "src/components/UserCard.tsx",
      "line": 42,
      "col": 23,
      "fn": "UserCard",
      "in_app": true,
    },
    {
      "file": "node_modules/react-dom/index.js",
      "line": 88,
      "col": 11,
      "fn": "renderRoute",
      "in_app": false,
    },
  ],
  "code_context": {
    "file": "src/components/UserCard.tsx",
    "error_line": 42,
    "lines": [
      "function UserCard({ user }: Props) {",
      "  return (",
      "    <div>{user.name}</div>",
      "  );",
      "}",
    ],
  },
  "runtime": "node-20.11",
  "manual_report": false,
  "level": "error",
  "occurred_at": "2026-04-29T14:22:01Z",
}
```

`code_context` populated by the SDK reading source at the error site (Node v1). Browser source-map support deferred to v2.

### DB: `projects`

```sql
CREATE TABLE projects (
  id          TEXT PRIMARY KEY,        -- proj_xxx
  name        TEXT NOT NULL,
  key         TEXT NOT NULL UNIQUE,    -- pk_live_xxx (used by SDK)
  created_at  INTEGER NOT NULL
);
```

### DB: `errors`

```sql
CREATE TABLE errors (
  id                TEXT PRIMARY KEY,           -- err_xxx (server-assigned)
  last_event_id     TEXT,                       -- most recent uuid from the SDK (idempotency)
  project_id        TEXT NOT NULL,
  fingerprint       TEXT NOT NULL,
  status            TEXT NOT NULL,              -- see status enum below
  type              TEXT,
  message           TEXT,
  stack             JSON,
  code_context      JSON,
  runtime           TEXT,
  occurrences       INTEGER NOT NULL DEFAULT 1,
  recurrence_count  INTEGER NOT NULL DEFAULT 0, -- bumped each time a merged error reoccurs
  first_seen_at     INTEGER NOT NULL,
  last_seen_at      INTEGER NOT NULL,
  fixed_at          INTEGER,
  merged_at         INTEGER,
  branch            TEXT,                       -- fix/pixel-{id} once runner creates it
  UNIQUE(project_id, fingerprint)               -- one row per fingerprint per project
);

CREATE INDEX errors_project_status ON errors(project_id, status);
CREATE INDEX errors_decay          ON errors(status, merged_at);
```

One row per `(project_id, fingerprint)`. New occurrences bump `occurrences` + `last_seen_at`. Recurrence after merge: status flips back to `open`, `recurrence_count++`.

### Status enum

| Status            | Meaning                       | Set by                       |
| ----------------- | ----------------------------- | ---------------------------- |
| `open`            | Reported, not picked up       | ingest                       |
| `in_progress`     | Agent session running         | runner (on assign)           |
| `awaiting_review` | Branch pushed, checks passed  | runner (on observed success) |
| `merged`          | User merged the branch        | webhook or manual PATCH      |
| `failed`          | Agent gave up / checks failed | runner (on observed failure) |

Recurrence is not a status — it's a transition. A `merged` error whose fingerprint reappears flips back to `open` with `recurrence_count` incremented. The agent payload surfaces this so the next session knows the prior fix didn't hold.

### Decay

```sql
DELETE FROM errors WHERE status='merged' AND merged_at < unixepoch() - 604800;
```

Daily cron. Only `merged` decays — `failed` and recurring errors stay visible.

### Agent context (runner → coding agent prompt)

This is the **derived, slimmed view** assembled by the runner per error. Brutally optimized for an agent to fix a bug, no dashboard fluff.

```
An error has been identified in this project. Investigate and fix it.

Error: TypeError — Cannot read properties of undefined (reading 'name')
Location: src/components/UserCard.tsx:42

Code at site:
  40 | function UserCard({ user }: Props) {
  41 |   return (
  42 |     <div>{user.name}</div>
  43 |   );
  44 | }

Stack:
  UserCard      src/components/UserCard.tsx:42
  renderRoute   src/router.tsx:88

Runtime: node-20.11
Occurrences: 47
First seen: 2h ago
Recurrence: this is the 2nd time this fingerprint has appeared after a previous fix was merged.

When done:
  1. Create branch: fix/pixel-err_a3f2c1
  2. Commit the fix
  3. Run pnpm check && pnpm lint && pnpm format:check (and tests if present)
  4. Push the branch

Do not merge. Do not mark anything as resolved yourself.
```

**Deliberately excluded:** user agents, IP, geo, session info, formatted timestamps, severity badges, tags, "affected users" counts. None of it helps decide what code to change.

---

## Package layout

```
packages/gg-pixel/
  ├── package.json
  ├── README.md
  └── src/
      ├── index.ts                    # init({ projectKey, sink? })
      ├── core/
      │   ├── types.ts                # WireEvent, StatusEnum, etc.
      │   ├── fingerprint.ts          # sha256(type + normalized top frame)
      │   ├── queue.ts                # in-memory queue + retry on transient sink failure
      │   └── sinks/
      │       ├── http.ts             # POST to ingest URL
      │       └── local-sqlite.ts     # ~/.gg/errors.db (dev mode, no network)
      ├── adapters/
      │   ├── node.ts                 # uncaughtException, unhandledRejection, console.error/warn monkey-patch
      │   └── browser.ts              # window.onerror, unhandledrejection (v2)
      └── code-context.ts             # fs.readFile around stack frame (Node only v1)
```

One package, multiple adapters under one roof since they share `core/`. Split later if browser symbolication gets heavy.

---

## API surface

```
POST   /ingest                              # SDK → backend (auth: project_key header)
GET    /api/projects
POST   /api/projects                        # → { id, key }
GET    /api/projects/:id/errors?status=open
GET    /api/errors/:id
PATCH  /api/errors/:id                      # update status (manual override)
GET    /api/stream?project_id=...           # SSE: error_new, status_change, error_recurring
```

Dashboard auth deferred to v1.5 (single-user assumed for v1).

---

## Onboarding flow (agent-driven)

Skill: `gg-pixel:install` or `kleio-coder pixel install` from inside a project dir.

The agent gets a dedicated system prompt and:

1. Detects runtime (`package.json`, `requirements.txt`, etc.)
2. `POST /api/projects` with the project name → receives `{ id, key }`
3. Installs the right SDK package (`@kenkaiiii/gg-pixel`)
4. Adds the init call at the entry point or framework hook
5. Writes the project key to `.env` or appropriate config
6. Triggers a deliberate test error to verify ingest works end-to-end
7. Updates `~/.gg/projects.json` mapping `project_id → local_path` (for the fix-queue runner)

```jsonc
// ~/.gg/projects.json
{
  "proj_abc123": { "name": "client-x-app", "path": "/Users/kenkai/Documents/client-x" },
  "proj_def456": { "name": "kleio-coder", "path": "/Users/example/Projects/kleio-coder" },
}
```

This file is local, not in the backend. Different machines map differently.

---

## Real-time delivery

**Server-Sent Events.** Dashboard opens one connection: `GET /api/stream?project_id=...`. Server pushes JSON lines:

```
data: {"type":"error_new","error":{...}}
data: {"type":"status_change","error_id":"err_xxx","status":"awaiting_review"}
data: {"type":"error_recurring","error_id":"err_xxx","recurrence_count":2}
```

One-way push, scales on Workers, simpler than WebSockets, sufficient for this workload.

---

## Fix-queue runner (`kleio-coder pixel`)

Global TUI command. Reuses the Tasks-pane engine: queue → spawn session → observe → mark → next.

Loop:

1. Read `~/.gg/projects.json` for path mappings.
2. Subscribe to SSE (or poll `/api/projects/:id/errors?status=open`) for each known project.
3. For each open error in priority order:
   - `cd` to project's local path
   - `PATCH /api/errors/:id { status: "in_progress" }`
   - Spawn a Kleio Coder session with the **agent context** payload as the prompt
   - Watch for: branch `fix/pixel-{id}` created? checks pass (project's `pnpm check` / `pytest` / etc.)? push succeeded?
   - All ✓ → `PATCH { status: "awaiting_review", branch: "fix/pixel-..." }`
   - Any ✗ → `PATCH { status: "failed" }`
4. Move to next.

**Concurrency:** one session per project at a time (avoid branch chaos within one repo). Multiple projects in parallel.

**Status reporting:** the runner sets status by **observing outcomes** (git state, exit codes), not by trusting agent self-reports.

**Branch convention:** `fix/pixel-{error_id}`. One branch per error. Atomic = easy to review, easy to revert.

---

## Out of scope for v1

- Browser SDK + source-map symbolication (Node-only first; covers Kleio Coder + deployed Node services)
- Heartbeats / uptime monitoring
- Notifications (email, Slack, push)
- Dashboard auth / multi-tenant (clients viewing their own projects)
- Auto-merge
- Performance / latency tracking
- Mobile SDKs (iOS, Android)
- Release / source-version tracking

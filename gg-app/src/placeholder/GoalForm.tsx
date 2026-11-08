import { useId, useState } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { createGoal, selectProject, type GoalSummary } from "../agent";
import "./placeholder.css";

/** Mirrors the sidecar's limits in `core/goals-store.ts`. */
const NAME_MAX = 15;
const GOAL_MAX = 2000;
const CONTEXT_MAX = 20;

interface ContextPick {
  path: string;
  kind: "folder" | "file";
}

/** Last path segment, for a compact row label (the full path is the tooltip). */
function baseName(p: string): string {
  const parts = p.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? p;
}

/**
 * Placeholder (the fork owns the desktop design) for upstream's New goal modal:
 * a name, the objective in a sentence or two, and optional folders and files
 * for context. Creating it opens the goal, where the coordinator replies on
 * its own. The sidecar validates every field; its reason is shown as is.
 */
export function GoalForm({
  onCancel,
  onCreated,
}: {
  onCancel: () => void;
  /** Called after the goal exists and this window is pointed at it. */
  onCreated: (goal: GoalSummary) => void;
}): React.ReactElement {
  const [name, setName] = useState("");
  const [goal, setGoal] = useState("");
  const [context, setContext] = useState<ContextPick[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const nameId = useId();
  const nameCountId = useId();
  const goalId = useId();
  const contextId = useId();

  const canCreate = name.trim().length > 0 && goal.trim().length > 0 && !busy;

  async function addContext(kind: "folder" | "file"): Promise<void> {
    try {
      const picked = await openDialog({
        directory: kind === "folder",
        multiple: true,
        title: kind === "folder" ? "Add folders to this goal" : "Add files to this goal",
      });
      const paths = picked === null ? [] : Array.isArray(picked) ? picked : [picked];
      if (paths.length > 0) {
        setContext((prev) => {
          const seen = new Set(prev.map((c) => c.path));
          const added = paths
            .filter((p) => !seen.has(p))
            .map((p): ContextPick => ({ path: p, kind }));
          return [...prev, ...added].slice(0, CONTEXT_MAX);
        });
      }
    } catch (e) {
      setError(`Couldn't open the picker: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  async function create(): Promise<void> {
    if (!canCreate) return;
    setBusy(true);
    setError(null);
    try {
      const created = await createGoal({
        name: name.trim(),
        goal: goal.trim(),
        context: context.map((c) => c.path),
      });
      // A goal opens as its own coordinator session in a fresh conversation.
      await selectProject(created.path);
      onCreated(created);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  const full = context.length >= CONTEXT_MAX;
  return (
    <form
      className="placeholder-form"
      aria-label="New goal"
      onSubmit={(event) => {
        event.preventDefault();
        void create();
      }}
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.stopPropagation();
        onCancel();
      }}
    >
      <label htmlFor={nameId}>Name</label>
      <input
        id={nameId}
        value={name}
        maxLength={NAME_MAX}
        aria-describedby={nameCountId}
        placeholder="API latency"
        autoFocus
        onChange={(e) => setName(e.target.value)}
      />
      <span id={nameCountId} className="placeholder-muted">
        {`${name.length}/${NAME_MAX}`}
      </span>

      <label htmlFor={goalId}>Goal</label>
      <textarea
        id={goalId}
        value={goal}
        maxLength={GOAL_MAX}
        rows={3}
        placeholder="Bring p95 latency under 200 ms across the whole API"
        onChange={(e) => setGoal(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            void create();
          }
        }}
      />

      <span id={contextId}>
        Context <span className="placeholder-muted">(optional)</span>
      </span>
      <span>
        <button type="button" disabled={busy || full} onClick={() => void addContext("folder")}>
          Add folders
        </button>{" "}
        <button type="button" disabled={busy || full} onClick={() => void addContext("file")}>
          Add files
        </button>
      </span>
      {context.length > 0 ? (
        <ul className="placeholder-list" aria-labelledby={contextId}>
          {context.map((item) => (
            <li key={item.path} title={item.path}>
              {baseName(item.path)}{" "}
              <span className="placeholder-muted">
                {item.kind === "folder" ? "folder" : "file"}
              </span>{" "}
              <button
                type="button"
                aria-label={`Remove ${baseName(item.path)}`}
                disabled={busy}
                onClick={() => setContext((prev) => prev.filter((c) => c.path !== item.path))}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <span className="placeholder-muted">
          Folders and files the goal is about, like repos, specs or mock-ups.
        </span>
      )}

      {error && (
        <p role="alert" className="placeholder-attention">
          {error}
        </p>
      )}
      <span>
        <button type="button" onClick={onCancel}>
          Cancel
        </button>{" "}
        <button type="submit" disabled={!canCreate}>
          {busy ? "Creating…" : "Create goal"}
        </button>
      </span>
    </form>
  );
}

import { useState } from "react";
import { theme } from "./theme";
import { Modal } from "./Modal";
import { createProject, ProjectExistsError, selectProject, setProjectHidden } from "./agent";

interface Props {
  /** Where new projects are created — shown so the user knows the destination. */
  projectsRoot: string;
  onClose: () => void;
  /** Called after the project is created + this window re-pointed at it. */
  onCreated: (cwd: string) => void;
}

/** Normalize freeform input toward a valid folder name (lowercase, dashes). */
function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** `root/name` in the root's own separator: the path the hint promises. */
function projectPath(root: string, name: string): string {
  const sep = root.includes("\\") && !root.includes("/") ? "\\" : "/";
  return `${root.replace(/[\\/]+$/, "")}${sep}${name}`;
}

export function NewProjectModal({ projectsRoot, onClose, onCreated }: Props): React.ReactElement {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The name is taken by a folder that's already there: offer to open it.
  const [existing, setExisting] = useState<string | null>(null);

  const slug = slugify(name);
  const canCreate = slug.length > 0 && !busy;
  const taken = existing !== null && existing === slug;

  // Un-hide first: a folder someone hid from the list must show again once
  // it's back in use, or leaving the project would lose it from the list.
  async function open(cwd: string): Promise<void> {
    await setProjectHidden(cwd, false).catch(() => {});
    await selectProject(cwd);
    onCreated(cwd);
  }

  async function create(): Promise<void> {
    if (!canCreate) return;
    setBusy(true);
    setError(null);
    try {
      if (taken) {
        await open(projectPath(projectsRoot, slug));
        return;
      }
      await open(await createProject(slug));
    } catch (e) {
      // Offer to open it only once the folder it lives in is known.
      if (e instanceof ProjectExistsError && projectsRoot.trim()) setExisting(slug);
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  return (
    <Modal title="New project" onClose={onClose}>
      <input
        className="modal-input"
        style={{ color: theme.text, background: theme.inputBackground }}
        value={name}
        placeholder="my-project"
        autoFocus
        onChange={(e) => {
          setName(e.target.value);
          setError(null);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") void create();
        }}
      />
      <div className="modal-hint" style={{ color: theme.textDim }}>
        {taken ? "Opens" : "Creates"}{" "}
        <span style={{ color: theme.textMuted }}>
          {projectsRoot}/{slug || "\u2026"}
        </span>
      </div>
      {error && (
        <div
          className="modal-error"
          role="alert"
          style={{ color: taken ? theme.textMuted : theme.error }}
        >
          {error}
        </div>
      )}
      <div className="modal-actions">
        <button className="modal-btn" onClick={onClose}>
          Cancel
        </button>
        <button className="modal-btn primary" disabled={!canCreate} onClick={() => void create()}>
          {taken ? (busy ? "Opening\u2026" : `Open ${slug}`) : busy ? "Creating\u2026" : "Create"}
        </button>
      </div>
    </Modal>
  );
}

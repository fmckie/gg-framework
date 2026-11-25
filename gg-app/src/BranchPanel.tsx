import { useEffect, useRef } from "react";
import { pluralize } from "./workspace-title";

// Only what the session's state carries: the branch, three counts and the
// repository's address. The app has no source for the changed files
// themselves, so there is no Changes view and no list.
export function BranchPanel({
  id,
  branch,
  uncommitted,
  pullRequests,
  issues,
  repoUrl,
  onOpen,
  onClose,
}: {
  id: string;
  branch: string;
  uncommitted: number;
  /** Null when the app has no count. */
  pullRequests: number | null;
  issues: number | null;
  repoUrl: string;
  onOpen: (url: string) => void;
  onClose: () => void;
}): React.ReactElement {
  const actionsRef = useRef<HTMLElement>(null);

  useEffect(() => {
    actionsRef.current?.querySelector("button")?.focus({ preventScroll: true });
  }, []);

  // On the bubble phase, so an open Usage popover takes Escape first.
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <section id={id} className="composer-panel branch-panel" aria-label="Branch">
      <header className="panel-header">
        <h3>{branch}</h3>
        {uncommitted > 0 && (
          <span className="panel-meta">
            {pluralize(uncommitted, "uncommitted file", "uncommitted files")}
          </span>
        )}
        <span className="panel-esc" aria-hidden="true">
          esc
        </span>
        <button
          type="button"
          className="panel-close"
          aria-label="Close Branch panel"
          onClick={onClose}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="m6 6 12 12M6 18 18 6" />
          </svg>
        </button>
      </header>
      <nav ref={actionsRef} className="branch-actions" aria-label="Branch views">
        {pullRequests !== null && (
          <button
            type="button"
            className="branch-action"
            onClick={() => onOpen(`${repoUrl}/pulls`)}
          >
            <span>Pull requests</span> <span className="view-count">{pullRequests}</span>
          </button>
        )}
        {issues !== null && (
          <button
            type="button"
            className="branch-action"
            onClick={() => onOpen(`${repoUrl}/issues`)}
          >
            <span>Issues</span> <span className="view-count">{issues}</span>
          </button>
        )}
        <button
          type="button"
          className="branch-action branch-github"
          onClick={() => onOpen(repoUrl)}
        >
          Open on GitHub
        </button>
      </nav>
    </section>
  );
}

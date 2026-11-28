import { useEffect, useRef } from "react";

// The row inside the bottom of the composer. A trigger with no panel behind it
// is not shown: Branch is there only when the session has one to show.
export function PanelEntryBar({
  moreOpen,
  morePanelId,
  onToggleMore,
  moreRef,
  branchName,
  branchOpen = false,
  branchPanelId,
  onToggleBranch,
  branchRef,
}: {
  moreOpen: boolean;
  morePanelId: string;
  onToggleMore: () => void;
  moreRef?: React.Ref<HTMLButtonElement>;
  /** The session's branch; without one there is no Branch trigger. */
  branchName?: string | null;
  branchOpen?: boolean;
  branchPanelId?: string;
  onToggleBranch?: () => void;
  branchRef?: React.Ref<HTMLButtonElement>;
}): React.ReactElement {
  return (
    <nav className="panel-entry-bar" aria-label="Composer panel entries">
      <button
        ref={moreRef}
        type="button"
        className="panel-entry more-entry"
        aria-expanded={moreOpen}
        aria-controls={moreOpen ? morePanelId : undefined}
        onClick={onToggleMore}
      >
        More <span aria-hidden="true">{"···"}</span>
      </button>
      {branchName && (
        <button
          ref={branchRef}
          type="button"
          className="panel-entry branch-entry"
          aria-label={`Branch ${branchName}`}
          aria-expanded={branchOpen}
          aria-controls={branchOpen ? branchPanelId : undefined}
          onClick={onToggleBranch}
        >
          <span aria-hidden="true">{"⑂"}</span> {branchName}
        </button>
      )}
    </nav>
  );
}

/** The session tools the phone's header has no room for. The desktop passes
 *  none: its header holds them. */
export interface MorePanelPhoneTools {
  onNotes: () => void;
  tasksLabel: string;
  onTasks: () => void;
  /** `/commit`, `/setup-commit` or Initialize Git; none when the project has neither. */
  commit: { label: string; disabled: boolean; onClick: () => void } | null;
  onHelp: () => void;
}

export function MorePanel({
  id,
  onChecklist,
  onClose,
  phoneTools,
}: {
  id: string;
  onChecklist: () => void;
  onClose: () => void;
  phoneTools?: MorePanelPhoneTools;
}): React.ReactElement {
  const firstRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    firstRef.current?.focus({ preventScroll: true });
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
    <section id={id} className="composer-panel more-panel" aria-label="More">
      <header className="panel-header">
        <h3>More</h3>
        <span className="panel-esc" aria-hidden="true">
          esc
        </span>
        <button
          type="button"
          className="panel-close"
          aria-label="Close More panel"
          onClick={onClose}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="m6 6 12 12M6 18 18 6" />
          </svg>
        </button>
      </header>
      <div className="priority-actions">
        {phoneTools && (
          <>
            <button
              ref={firstRef}
              type="button"
              className="priority-action"
              onClick={phoneTools.onNotes}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M6 3h9l4 4v14H6zM9 11h7M9 15h7" />
              </svg>
              <span>Notes</span>
            </button>
            <button type="button" className="priority-action" onClick={phoneTools.onTasks}>
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M4 4h16v16H4zM8 12l3 3 5-6" />
              </svg>
              <span>{phoneTools.tasksLabel}</span>
            </button>
          </>
        )}
        <button
          ref={phoneTools ? undefined : firstRef}
          type="button"
          className="priority-action"
          onClick={onChecklist}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="m3 6 2 2 3-4M11 6h10M3 13h3m5 0h10M3 20h3m5 0h10" />
          </svg>
          <span>Checklist</span>
        </button>
        {phoneTools?.commit && (
          <button
            type="button"
            className="priority-action"
            disabled={phoneTools.commit.disabled}
            onClick={phoneTools.commit.onClick}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M3 12h6m6 0h6M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z" />
            </svg>
            <span>{phoneTools.commit.label}</span>
          </button>
        )}
        {phoneTools && (
          <button type="button" className="priority-action" onClick={phoneTools.onHelp}>
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6v.6M12 17h.01" />
            </svg>
            <span>Help</span>
          </button>
        )}
      </div>
    </section>
  );
}

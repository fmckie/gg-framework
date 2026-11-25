import { useEffect, useRef } from "react";

// The row inside the bottom of the composer. A trigger with no panel behind it
// is not shown, so today it holds More alone.
export function PanelEntryBar({
  moreOpen,
  morePanelId,
  onToggleMore,
  moreRef,
}: {
  moreOpen: boolean;
  morePanelId: string;
  onToggleMore: () => void;
  moreRef?: React.Ref<HTMLButtonElement>;
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
    </nav>
  );
}

export function MorePanel({
  id,
  onChecklist,
  onClose,
}: {
  id: string;
  onChecklist: () => void;
  onClose: () => void;
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
    <section id={id} className="more-panel" aria-label="More">
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
        <button ref={firstRef} type="button" className="priority-action" onClick={onChecklist}>
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="m3 6 2 2 3-4M11 6h10M3 13h3m5 0h10M3 20h3m5 0h10" />
          </svg>
          <span>Checklist</span>
        </button>
      </div>
    </section>
  );
}

import { useId, useRef } from "react";
import { createPortal } from "react-dom";
import { theme } from "./theme";
import { useDialogFocus } from "./dialog-focus";
import { withViewTransition } from "./view-transition";

/** Reusable centered modal with Escape, focus containment, and focus return. */
export function Modal({
  title,
  children,
  onClose,
  className,
}: {
  title: React.ReactNode;
  children: React.ReactNode;
  onClose: () => void;
  /** Extra class on the `.modal` box (e.g. width overrides). */
  className?: string;
}): React.ReactElement {
  const dialogRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  // The modal's own dismissals (Escape, backdrop, ×) animate out. Closes the
  // parent triggers itself (Save, Cancel) stay instant: they usually open the
  // next thing, and a fading ghost would sit over it.
  const dismiss = (): void => withViewTransition(onClose);
  useDialogFocus(dialogRef, dismiss);

  // Portalled to <body>. A modal opened from a trigger nested inside the app
  // shell (the radio button lives in the nav bar) would otherwise be trapped in
  // that ancestor's stacking context, and paint UNDER later siblings — the
  // transcript showed straight through the panel. Rendering at the document
  // root makes every modal immune to wherever its trigger happens to live.
  return createPortal(
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) dismiss();
      }}
    >
      <div
        ref={dialogRef}
        className={className ? `modal ${className}` : "modal"}
        style={{ background: theme.surface2, borderColor: theme.border }}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        <div className="modal-head">
          <h2 id={titleId} className="modal-title" style={{ color: theme.text }}>
            {title}
          </h2>
          <button
            className="modal-close"
            type="button"
            aria-label="Close"
            title="Close"
            onClick={dismiss}
          >
            {"\u00d7"}
          </button>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  );
}

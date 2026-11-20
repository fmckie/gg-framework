// The quiet Remove group a desktop Settings page ends with. Each item says
// what goes, then asks once: "Remove …" is red text, and only its confirm step
// (Keep, or the red-edged final button) looks like a decision. Asking moves
// focus to Keep, the safe answer, and brings what removing does into view.

import { useEffect, useId, useRef, useState } from "react";

export function RemoveGroup({ children }: { children: React.ReactNode }): React.ReactElement {
  const id = useId();
  return (
    <section className="st-danger" aria-labelledby={id}>
      <h2 className="st-label" id={id}>
        Remove
      </h2>
      <div className="st-danger-body">{children}</div>
    </section>
  );
}

/**
 * One thing to remove. `ask` is the first button's words (shown with "…"),
 * `confirm` the final button's, `hint` what removing does. `onRemove` throws
 * when it couldn't, and `describeError` puts why in words. `label` is the first
 * button's name when its words don't say which thing (one of several devices).
 */
export function RemoveItem({
  what,
  ask,
  label,
  confirm,
  busyText,
  hint,
  onRemove,
  describeError,
}: {
  what: string;
  ask: string;
  label?: string;
  confirm: string;
  busyText: string;
  hint: string;
  onRemove: () => Promise<void>;
  describeError: (e: unknown) => string;
}): React.ReactElement {
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const itemRef = useRef<HTMLDivElement>(null);
  const askRef = useRef<HTMLButtonElement>(null);
  const keepRef = useRef<HTMLButtonElement>(null);
  // Not on mount: focus moves only once someone has asked or answered.
  const settled = useRef(false);
  useEffect(() => {
    if (!settled.current) {
      settled.current = true;
      return;
    }
    (asking ? keepRef : askRef).current?.focus();
    // The hint opens under the buttons, and Remove ends its page: without this
    // it can open below the fold, unread at the moment of deciding.
    if (asking) itemRef.current?.scrollIntoView?.({ block: "nearest" });
  }, [asking]);
  // Why it couldn't, likewise.
  useEffect(() => {
    if (error) itemRef.current?.scrollIntoView?.({ block: "nearest" });
  }, [error]);

  async function remove(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await onRemove();
      setAsking(false);
    } catch (e) {
      setError(describeError(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="st-danger-item" ref={itemRef}>
      <span className="st-danger-what">{what}</span>
      <span className="st-danger-actions">
        {asking ? (
          <>
            <button
              ref={keepRef}
              type="button"
              className="btn btn-ghost btn-sm"
              disabled={busy}
              onClick={() => {
                setError(null);
                setAsking(false);
              }}
            >
              Keep
            </button>
            <button
              type="button"
              className="btn btn-sm btn-destructive is-confirm"
              disabled={busy}
              onClick={() => void remove()}
            >
              {busy ? busyText : confirm}
            </button>
          </>
        ) : (
          <button
            ref={askRef}
            type="button"
            className="btn btn-sm btn-destructive"
            aria-label={label}
            onClick={() => setAsking(true)}
          >
            {`${ask}…`}
          </button>
        )}
      </span>
      {asking && <p className="st-danger-hint">{hint}</p>}
      {error && (
        <p className="st-danger-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

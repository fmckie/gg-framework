import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

// One solid colour for both fills: the hue runs from green at 0 to red at 100.
export function contextFill(pct: number): string {
  return `hsl(${Math.round((120 - 1.2 * pct) * 10) / 10} 70% 65%)`;
}

export function ContextButton({ pct }: { pct: number }): React.ReactElement {
  const clamped = Math.max(0, Math.min(100, pct));
  const fill = contextFill(clamped);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ left: number; bottom: number } | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const id = useId();

  const close = (restoreFocus: boolean): void => {
    setOpen(false);
    if (restoreFocus) buttonRef.current?.focus({ preventScroll: true });
  };

  useLayoutEffect(() => {
    if (!open) return;
    const place = (): void => {
      const rect = buttonRef.current?.getBoundingClientRect();
      if (!rect) return;
      const width = popoverRef.current?.getBoundingClientRect().width ?? 0;
      setPos({
        left: Math.max(12, Math.min(rect.left, window.innerWidth - width - 12)),
        bottom: window.innerHeight - rect.top + 8,
      });
    };
    place();
    closeRef.current?.focus({ preventScroll: true });
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const inside = (target: EventTarget | null): boolean =>
      target instanceof Node &&
      (popoverRef.current?.contains(target) === true ||
        buttonRef.current?.contains(target) === true);
    // Captured, so Escape closes Usage before any panel under it.
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopImmediatePropagation();
      setOpen(false);
      buttonRef.current?.focus({ preventScroll: true });
    };
    // A click or a Tab outside closes it and leaves focus where it went.
    const onOutside = (e: Event): void => {
      if (!inside(e.target)) setOpen(false);
    };
    document.addEventListener("keydown", onKey, true);
    document.addEventListener("pointerdown", onOutside, true);
    document.addEventListener("focusin", onOutside);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      document.removeEventListener("pointerdown", onOutside, true);
      document.removeEventListener("focusin", onOutside);
    };
  }, [open]);

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className="ctx-button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={() => (open ? close(true) : setOpen(true))}
      >
        <span className="ctx-word">Context</span>
        <span className="ctx-track" aria-hidden="true">
          <i style={{ width: `${clamped}%`, backgroundColor: fill }} />
        </span>
        <span className="ctx-value">{clamped}%</span>
      </button>
      {open &&
        createPortal(
          <div
            ref={popoverRef}
            id={id}
            className="usage-popover"
            role="dialog"
            aria-modal="false"
            aria-labelledby={`${id}-title`}
            aria-describedby={`${id}-note`}
            style={{ left: pos?.left ?? 12, bottom: pos?.bottom ?? 0 }}
          >
            <header>
              <h3 id={`${id}-title`}>Usage</h3>
              <button
                ref={closeRef}
                type="button"
                className="usage-close"
                aria-label="Close Usage"
                onClick={() => close(true)}
              >
                {"×"}
              </button>
            </header>
            <p>
              <span>Current conversation context</span>
              <strong>{clamped}%</strong>
            </p>
            <div
              className="usage-meter"
              role="meter"
              aria-label="Current conversation context"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={clamped}
              aria-valuetext={`${clamped}% of context occupied`}
            >
              <i style={{ width: `${clamped}%`, backgroundColor: fill }} />
            </div>
            <small id={`${id}-note`}>
              {clamped > 0
                ? "Measured when the last turn ended."
                : "No reading yet. It is measured when a turn ends."}
            </small>
          </div>,
          document.body,
        )}
    </>
  );
}

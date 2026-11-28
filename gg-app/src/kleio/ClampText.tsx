// A description that may be long (a specialist's job). The phone clamps it to
// a few lines (kleio-phone.css) and a tap shows the rest; the desktop shows it
// whole, in the same element it always had.

import { useLayoutEffect, useRef, useState } from "react";
import { isPhone } from "../platform";

export function ClampText({
  className,
  children,
}: {
  className: string;
  children: string;
}): React.ReactElement {
  const phone = isPhone();
  const body = useRef<HTMLSpanElement>(null);
  const [open, setOpen] = useState(false);
  const [cut, setCut] = useState(false);

  useLayoutEffect(() => {
    const el = body.current;
    if (!phone || open || !el) return;
    const measure = (): void => setCut(el.scrollHeight > el.clientHeight + 1);
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [phone, open, children]);

  if (!phone) return <p className={className}>{children}</p>;
  const toggle = (): void => setOpen((o) => !o);
  // Only text that is cut (or was opened) is a button: a short one is just text.
  const press = (open || cut) && {
    role: "button",
    tabIndex: 0,
    "aria-expanded": open,
    onClick: toggle,
    onKeyDown: (event: React.KeyboardEvent) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      toggle();
    },
  };
  return (
    <p className={`${className} clamp-text`} data-open={open || undefined} {...press}>
      <span ref={body} className="clamp-body">
        {children}
      </span>
    </p>
  );
}

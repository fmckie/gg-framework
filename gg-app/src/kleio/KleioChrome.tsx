// Page chrome for the Agents and Groups views, made from the same parts as the
// Chats and Code pickers so the three sections read as one app: the picker
// header (Back, title, actions, then the radio and window-layout buttons),
// Settings-style cards, and a chat with a sidebar of cards on its left. The
// sidebar collapses from the header's sidebar button (remembered between
// visits); below 900px it slides over the chat instead (see kleio-pages.css).

import { useCallback, useEffect, useId, useRef, useState, useSyncExternalStore } from "react";
import { DotsThreeIcon, NotePencilIcon, PlugsIcon, SidebarSimpleIcon } from "@phosphor-icons/react";
import { BackButton } from "../BackButton";
import { isPhone } from "../platform";
import { RadioButton } from "../RadioButton";
import { WindowLayoutButton } from "../WindowLayoutButton";

/** One of the phone header's menu entries: a header button it has no room for. */
export interface KleioMenuItem {
  label: string;
  onSelect: () => void;
  disabled?: boolean;
}

/** The phone header's "⋯": the buttons the desktop's header has a row for.
 *  `extra` (a field, say) sits under the entries; the popup is then a small
 *  dialog rather than a menu, since a menu holds only its entries. */
export function KleioMenu({
  items,
  label = "More",
  extra,
}: {
  items: readonly KleioMenuItem[];
  label?: string;
  extra?: React.ReactNode;
}): React.ReactElement {
  const [open, setOpen] = useState(false);
  const id = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    menuRef.current?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setOpen(false);
      triggerRef.current?.focus();
    };
    const onOutside = (event: PointerEvent): void => {
      const target = event.target as Node;
      if (menuRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onOutside, true);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onOutside, true);
    };
  }, [open]);

  function moveFocus(event: React.KeyboardEvent<HTMLDivElement>): void {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    const entries = Array.from(
      menuRef.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? [],
    );
    const at = entries.indexOf(document.activeElement as HTMLButtonElement);
    const step = event.key === "ArrowDown" ? 1 : -1;
    entries[(at + step + entries.length) % entries.length]?.focus();
  }

  return (
    <span className="kleio-menu-wrap">
      <button
        ref={triggerRef}
        type="button"
        className="btn btn-ghost btn-icon kleio-menu-btn"
        aria-label={label}
        title={label}
        aria-haspopup={extra ? "dialog" : "menu"}
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={() => setOpen((o) => !o)}
      >
        <DotsThreeIcon size={20} weight="bold" aria-hidden="true" />
      </button>
      {open && (
        <div
          ref={menuRef}
          id={id}
          className="kleio-menu"
          role={extra ? "dialog" : "menu"}
          aria-label={label}
          onKeyDown={moveFocus}
        >
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              role={extra ? undefined : "menuitem"}
              disabled={item.disabled}
              onClick={() => {
                setOpen(false);
                item.onSelect();
              }}
            >
              {item.label}
            </button>
          ))}
          {extra}
        </div>
      )}
    </span>
  );
}

export function KleioHead({
  backLabel = "Back",
  onBack,
  tools,
  leading,
  title,
  subtitle,
  status,
  actions,
  phoneMenu,
}: {
  backLabel?: string;
  onBack: () => void;
  /** Right after Back: the sidebar and new-conversation buttons. */
  tools?: React.ReactNode;
  /** Before the title, e.g. the agent's blob. */
  leading?: React.ReactNode;
  title: string;
  /** A chat's state, beside the title. */
  subtitle?: React.ReactNode;
  /** Beside the title: count badges, state, search. */
  status?: React.ReactNode;
  /** Right-aligned, before the radio and window-layout buttons. */
  actions?: React.ReactNode;
  /** The phone's one row: `tools` and `actions` as the entries of one "⋯". */
  phoneMenu?: readonly KleioMenuItem[];
}): React.ReactElement {
  if (phoneMenu && isPhone())
    return (
      <div className="picker-head kleio-head has-menu" data-tauri-drag-region>
        <BackButton label={backLabel} onClick={onBack} />
        {leading}
        <h1 className="picker-title">{title}</h1>
        {subtitle}
        {status}
        {phoneMenu.length > 0 && (
          <span className="picker-head-actions">
            <KleioMenu items={phoneMenu} />
          </span>
        )}
      </div>
    );
  return (
    <div className="picker-head kleio-head" data-tauri-drag-region>
      <BackButton label={backLabel} onClick={onBack} />
      {tools && <span className="kleio-head-tools">{tools}</span>}
      {leading}
      <h1 className="picker-title">{title}</h1>
      {subtitle}
      {status}
      <span className="picker-head-actions">
        {actions}
        <RadioButton />
        <WindowLayoutButton />
      </span>
    </div>
  );
}

/** A Settings-style card with a title row (optional count and action). */
export function KleioPanel({
  title,
  count,
  action,
  description,
  children,
}: {
  title: string;
  count?: number;
  action?: React.ReactNode;
  description?: React.ReactNode;
  children?: React.ReactNode;
}): React.ReactElement {
  const id = useId();
  return (
    <section className="settings-card kleio-panel" aria-labelledby={id}>
      <div className="kleio-panel-head">
        <h2 className="settings-section-title" id={id}>
          {title}
        </h2>
        {count !== undefined && <span className="kleio-panel-count">{count}</span>}
        {action && <span className="kleio-panel-action">{action}</span>}
      </div>
      {description && <p className="settings-desc">{description}</p>}
      {children}
    </section>
  );
}

// ─── the sidebar ──────────────────────────────────────────────────────────

const NARROW_QUERY = "(max-width: 900px)";
const HIDDEN_KEY = "kleio-sidebar-hidden";

function subscribeNarrow(onChange: () => void): () => void {
  if (typeof window.matchMedia !== "function") return () => undefined;
  const mq = window.matchMedia(NARROW_QUERY);
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
}

function narrowNow(): boolean {
  return typeof window.matchMedia === "function" && window.matchMedia(NARROW_QUERY).matches;
}

function readHidden(): boolean {
  try {
    return localStorage.getItem(HIDDEN_KEY) === "1";
  } catch {
    return false;
  }
}

function writeHidden(hidden: boolean): void {
  try {
    localStorage.setItem(HIDDEN_KEY, hidden ? "1" : "0");
  } catch {
    // Private storage unavailable: the choice lasts until the page closes.
  }
}

export interface Sidebar {
  /** Showing: beside the chat when wide, over it when narrow. */
  open: boolean;
  /** Narrow window: the sidebar is a drawer over the chat. */
  narrow: boolean;
  toggle: () => void;
  close: () => void;
}

/** Wide windows remember whether the sidebar is collapsed; narrow ones start
 *  with the drawer closed every time. */
export function useSidebar(): Sidebar {
  const narrow = useSyncExternalStore(subscribeNarrow, narrowNow, () => false);
  const [hidden, setHidden] = useState(readHidden);
  const [drawer, setDrawer] = useState(false);
  const toggle = useCallback(() => {
    if (narrow) {
      setDrawer((o) => !o);
      return;
    }
    writeHidden(!hidden);
    setHidden(!hidden);
  }, [narrow, hidden]);
  const close = useCallback(() => setDrawer(false), []);
  return { open: narrow ? drawer : !hidden, narrow, toggle, close };
}

/** Header button that shows or hides the sidebar. */
export function SideToggle({
  sidebar,
  controls,
}: {
  sidebar: Sidebar;
  controls: string;
}): React.ReactElement {
  const label = sidebar.open ? "Hide sidebar" : "Show sidebar";
  return (
    <button
      type="button"
      className="btn btn-ghost btn-sm btn-nav-icon kleio-icon-btn"
      title={label}
      aria-label={label}
      aria-expanded={sidebar.open}
      aria-controls={controls}
      onClick={sidebar.toggle}
    >
      <SidebarSimpleIcon size={16} weight="bold" aria-hidden="true" />
    </button>
  );
}

/** Header button for a fresh conversation (the familiar square and pen). */
export function NewChatButton({
  onClick,
  disabled = false,
}: {
  onClick: () => void;
  disabled?: boolean;
}): React.ReactElement {
  return (
    <button
      type="button"
      className="btn btn-ghost btn-sm btn-nav-icon kleio-icon-btn"
      title="New conversation"
      aria-label="New conversation"
      disabled={disabled}
      onClick={onClick}
    >
      <NotePencilIcon size={16} weight="bold" aria-hidden="true" />
    </button>
  );
}

/** Header button to the Apps page (Gmail, Notion, Reddit…), from Agents and Groups. */
export function AppsButton({ onClick }: { onClick: () => void }): React.ReactElement {
  return (
    <button type="button" className="btn btn-ghost btn-sm kleio-apps-btn" onClick={onClick}>
      <PlugsIcon size={14} weight="bold" aria-hidden="true" />
      Connect apps
    </button>
  );
}

/** A sidebar of cards on the left of the main area. */
export function KleioSplit({
  main,
  side,
  sideId,
  sideLabel,
  sidebar,
}: {
  main: React.ReactNode;
  side: React.ReactNode;
  sideId: string;
  sideLabel: string;
  sidebar: Sidebar;
}): React.ReactElement {
  const { open, narrow, close } = sidebar;
  const drawerOpen = narrow && open;

  useEffect(() => {
    if (!drawerOpen) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [drawerOpen, close]);

  const classes = [
    "kleio-split",
    !narrow && !open && "is-side-collapsed",
    drawerOpen && "is-side-open",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={classes}>
      <aside id={sideId} className="kleio-side" aria-label={sideLabel} inert={!open}>
        <div className="kleio-side-inner">{side}</div>
      </aside>
      {drawerOpen && (
        <button
          type="button"
          className="kleio-side-scrim"
          aria-label="Hide sidebar"
          tabIndex={-1}
          onClick={close}
        />
      )}
      <div className="kleio-split-main">{main}</div>
    </div>
  );
}

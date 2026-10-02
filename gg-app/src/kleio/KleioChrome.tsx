// Page chrome for the Agents and Groups views, made from the same parts as the
// Chats and Code pickers so the three sections read as one app: the picker
// header (Back, title, actions, then the radio and window-layout buttons),
// Settings-style cards, and a chat with a sidebar of cards on its left. The
// sidebar collapses from the header's sidebar button (remembered between
// visits); below 900px it slides over the chat instead (see kleio-pages.css).

import { useCallback, useEffect, useId, useState, useSyncExternalStore } from "react";
import { NotePencilIcon, PlugsIcon, SidebarSimpleIcon } from "@phosphor-icons/react";
import { BackButton } from "../BackButton";
import { RadioButton } from "../RadioButton";
import { WindowLayoutButton } from "../WindowLayoutButton";

export function KleioHead({
  backLabel = "Back",
  onBack,
  tools,
  leading,
  title,
  status,
  actions,
}: {
  backLabel?: string;
  onBack: () => void;
  /** Right after Back: the sidebar and new-conversation buttons. */
  tools?: React.ReactNode;
  /** Before the title, e.g. the agent's blob. */
  leading?: React.ReactNode;
  title: string;
  /** Beside the title: count badges, state, search. */
  status?: React.ReactNode;
  /** Right-aligned, before the radio and window-layout buttons. */
  actions?: React.ReactNode;
}): React.ReactElement {
  return (
    <div className="picker-head kleio-head" data-tauri-drag-region>
      <BackButton label={backLabel} onClick={onBack} />
      {tools && <span className="kleio-head-tools">{tools}</span>}
      {leading}
      <h1 className="picker-title">{title}</h1>
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

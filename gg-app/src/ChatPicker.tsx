import { useEffect, useRef, useState } from "react";
import { XIcon } from "@phosphor-icons/react";
import { theme } from "./theme";
import {
  deleteChat,
  getSettings,
  listSessions,
  selectWorkspace,
  waitForReady,
  type ChatAgentId,
  type RecentSession,
} from "./agent";
import { motionWorkspacePath } from "./motion-workspace";
import { Badge } from "./Badge";
import { BackButton } from "./BackButton";
import { ListSkeleton } from "./Skeleton";
import { RadioButton } from "./RadioButton";
import { WindowLayoutButton } from "./WindowLayoutButton";
import { MetalButton } from "./MetalButton";
import { useWindowFocused } from "./useWindowFocused";

interface Props {
  onChosen: (cwd: string) => void;
  onClose?: () => void;
  initialAgent?: ChatAgentId;
  /** Which non-coding workspace this picker opens. Defaults to chat. */
  mode?: "chat" | "motion";
}

/** How long the inline "Delete" confirm waits before reverting to the X. */
const CONFIRM_TIMEOUT_MS = 4000;

const COPY = {
  chat: {
    title: "Chats",
    newLabel: "+ New chat",
    empty: "No previous chats yet.",
    noRoot: "Choose a projects folder in Settings before starting a chat.",
    loadError: "Chats could not be loaded.",
  },
  motion: {
    title: "Motion",
    newLabel: "+ New video",
    empty: "No motion sessions yet.",
    noRoot: "Choose a projects folder in Settings before starting a video.",
    loadError: "Motion sessions could not be loaded.",
  },
} as const;

/** Session chooser for Chat or Motion, rooted at the configured projects folder. */
export function ChatPicker({
  onChosen,
  onClose,
  initialAgent = "general",
  mode = "chat",
}: Props): React.ReactElement {
  const copy = COPY[mode];
  const windowFocused = useWindowFocused();
  const [projectsRoot, setProjectsRoot] = useState("");
  const [sessions, setSessions] = useState<RecentSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Two-step delete (chat mode only): which row shows "Delete", which is mid-delete.
  const [confirmPath, setConfirmPath] = useState<string | null>(null);
  const [deletingPath, setDeletingPath] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const confirmRef = useRef<HTMLButtonElement | null>(null);
  const canDelete = mode === "chat";

  useEffect(() => {
    if (!confirmPath) return;
    confirmRef.current?.focus();
    const timer = window.setTimeout(() => setConfirmPath(null), CONFIRM_TIMEOUT_MS);
    return () => window.clearTimeout(timer);
  }, [confirmPath]);

  // The window shortcuts (cycle, arrange) work here through App's listener;
  // handling them here as well made one press act twice.

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    void getSettings()
      .then(async (settings) => {
        const projects = settings?.projectsRoot.trim() ?? "";
        if (!projects) throw new Error(copy.noRoot);
        const root = mode === "motion" ? motionWorkspacePath(projects) : projects;
        if (!cancelled) setProjectsRoot(root);
        await waitForReady();
        return listSessions(root, mode === "motion" ? "motion" : "all");
      })
      .then((recent) => {
        if (!cancelled) setSessions(recent);
      })
      .catch((reason: unknown) => {
        if (!cancelled) {
          setError(reason instanceof Error ? reason.message : copy.loadError);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [copy, mode]);

  function choose(session?: RecentSession): void {
    if (busy || !projectsRoot) return;
    setBusy(true);
    void selectWorkspace(mode, projectsRoot, session?.path, session?.chatAgent ?? initialAgent)
      .then(() => onChosen(projectsRoot))
      .catch(() => setBusy(false));
  }

  function removeChat(session: RecentSession): void {
    if (deletingPath) return;
    setConfirmPath(null);
    setDeletingPath(session.path);
    setDeleteError(null);
    void deleteChat(session.path).then((result) => {
      setDeletingPath(null);
      if (result.ok) {
        setSessions((current) => current.filter((item) => item.path !== session.path));
      } else {
        setDeleteError(result.error);
      }
    });
  }

  return (
    <div className="picker chat-picker">
      <div className="picker-head" data-tauri-drag-region>
        {onClose ? <BackButton label="Back" onClick={onClose} /> : null}
        <span className="picker-title">{copy.title}</span>
        {!loading && !error && <Badge>{sessions.length}</Badge>}
        <span className="picker-head-actions">
          <MetalButton
            windowFocused={windowFocused}
            className="btn btn-primary btn-sm"
            disabled={busy || loading || !projectsRoot}
            onClick={() => choose()}
          >
            {copy.newLabel}
          </MetalButton>
          <RadioButton />
          <WindowLayoutButton />
        </span>
      </div>

      <div className="picker-list">
        {deleteError && (
          <div className="picker-error" role="alert">
            {deleteError}
          </div>
        )}
        {loading && <ListSkeleton rows={5} />}
        {!loading && error && (
          <div className="picker-empty" style={{ color: theme.textMuted }}>
            {error}
          </div>
        )}
        {!loading && !error && sessions.length === 0 && (
          <div className="picker-empty">
            <span style={{ color: theme.textMuted }}>{copy.empty}</span>
            <MetalButton
              windowFocused={windowFocused}
              className="btn btn-primary btn-sm"
              disabled={busy}
              onClick={() => choose()}
            >
              {copy.newLabel}
            </MetalButton>
          </div>
        )}
        {!loading && !error && sessions.length > 0 && (
          <div className="picker-reveal">
            {sessions.map((session) => {
              const preview = session.preview || "(no preview)";
              const confirming = confirmPath === session.path;
              const deleting = deletingPath === session.path;
              return (
                <div
                  key={session.id}
                  className={
                    canDelete ? "picker-item-wrap picker-item-deletable" : "picker-item-wrap"
                  }
                  onMouseLeave={confirming ? () => setConfirmPath(null) : undefined}
                >
                  <button
                    className="picker-item"
                    disabled={busy || deleting}
                    onClick={() => choose(session)}
                  >
                    <span className="picker-row">
                      <span className="picker-name picker-preview" style={{ color: theme.text }}>
                        {preview}
                      </span>
                      <Badge>{session.lastActiveDisplay}</Badge>
                    </span>
                    <span className="picker-meta" style={{ color: theme.textMuted }}>
                      {`${session.messageCount} msgs`}
                    </span>
                  </button>
                  {canDelete && confirming && (
                    <button
                      ref={confirmRef}
                      className="picker-hide picker-delete-confirm"
                      aria-label={`Delete chat permanently: ${preview}`}
                      title="Delete permanently"
                      // WebKit (the iPhone and Mac apps) never focuses a pressed
                      // button: it clears focus on mousedown, which would blur this
                      // one and cancel the delete before the click lands.
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => removeChat(session)}
                      onBlur={() => setConfirmPath(null)}
                      onKeyDown={(event) => {
                        if (event.key === "Escape") {
                          event.preventDefault();
                          event.stopPropagation();
                          setConfirmPath(null);
                        }
                      }}
                    >
                      Delete
                    </button>
                  )}
                  {canDelete && !confirming && (
                    <button
                      className="picker-hide picker-delete"
                      aria-label={`Remove chat: ${preview}`}
                      title="Remove chat"
                      disabled={busy || deleting}
                      onClick={() => {
                        setDeleteError(null);
                        setConfirmPath(session.path);
                      }}
                    >
                      <XIcon size={12} weight="bold" aria-hidden="true" />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

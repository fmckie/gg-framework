// Specialists (Blobs in the code): Kleio's helpers, each with one job. A list
// laid out like Chats and Code; a specialist opens into its chat with a sidebar of cards on the left (job,
// schedules, recent activity) that collapses from the header. New and edit are
// full-page forms. Every change goes to the Mac mini, so the phone sees it too.

import { useCallback, useEffect, useId, useMemo, useState } from "react";
import { PencilSimpleIcon, TrashIcon } from "@phosphor-icons/react";
import { Badge } from "../Badge";
import { ConfirmModal } from "../ConfirmModal";
import { MetalButton } from "../MetalButton";
import { ListSkeleton } from "../Skeleton";
import { theme } from "../theme";
import { useWindowFocused } from "../useWindowFocused";
import { AgentRowContent, agentRowState } from "./AgentRow";
import { AgentAvatar, BlobAvatar } from "./BlobAvatar";
import { BlobForm } from "./BlobForm";
import { Schedules } from "./BlobSchedules";
import { describeAutoSchedules } from "./blobFormat";
import {
  AppsButton,
  KleioHead,
  KleioPanel,
  KleioSplit,
  NewChatButton,
  SideToggle,
  useSidebar,
} from "./KleioChrome";
import type { HistoryEntry } from "../agent";
import { AssetsPanel, collectAssets, type Asset } from "./AssetsPanel";
import { fileOwner } from "./kleioFiles";
import {
  deleteBlob,
  errorText,
  getBlobActivity,
  getBlobSession,
  listBlobs,
  newBlobSession,
  type Blob,
  type BlobSaved,
} from "./kleioApi";
import { ThreadChat } from "./ThreadChat";

const REFRESH_MS = 10_000;

type View =
  | { kind: "list" }
  | { kind: "create" }
  | { kind: "edit"; id: string }
  | { kind: "detail"; id: string; note?: string };

export function BlobsPage({
  onClose,
  onListChange,
  onOpenApps,
  openId,
}: {
  /** Leave Specialists (Back on the list). */
  onClose: () => void;
  /** Told whether the list is showing, so the screen can show its switcher. */
  onListChange?: (atList: boolean) => void;
  /** Open the Apps page (a "Connect apps" button on the list). */
  onOpenApps?: () => void;
  /** Open straight into this agent's chat (a tapped notification). */
  openId?: string;
}): React.ReactElement {
  const [blobs, setBlobs] = useState<Blob[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<View>(
    openId ? { kind: "detail", id: openId } : { kind: "list" },
  );

  const load = useCallback(async (): Promise<void> => {
    try {
      setBlobs(await listBlobs());
      setError(null);
    } catch (e) {
      setError(errorText(e));
    }
  }, []);

  useEffect(() => {
    void load();
    const id = window.setInterval(() => void load(), REFRESH_MS);
    return () => window.clearInterval(id);
  }, [load]);

  useEffect(() => {
    onListChange?.(view.kind === "list");
  }, [view.kind, onListChange]);

  function saved(r: BlobSaved): void {
    void load();
    const note = describeAutoSchedules(r.autoSchedules);
    setView({ kind: "detail", id: r.blob.id, ...(note ? { note } : {}) });
  }

  const byId = (id: string): Blob | undefined => blobs?.find((b) => b.id === id);
  const toList = (): void => setView({ kind: "list" });

  if (view.kind === "create" || view.kind === "edit") {
    const blob = view.kind === "edit" ? byId(view.id) : undefined;
    return (
      <BlobForm
        {...(blob ? { blob } : {})}
        others={(blobs ?? []).filter((b) => b.id !== blob?.id)}
        onSaved={saved}
        onCancel={() => setView(blob ? { kind: "detail", id: blob.id } : { kind: "list" })}
      />
    );
  }

  if (view.kind === "detail") {
    const blob = byId(view.id);
    if (!blob) {
      return (
        <>
          <KleioHead onBack={toList} title="Specialists" />
          <div className="picker-empty" style={{ color: theme.textMuted }}>
            {blobs === null ? (
              "Loading…"
            ) : (
              <>
                <span>That specialist no longer exists.</span>
                <button type="button" className="btn btn-ghost btn-sm" onClick={toList}>
                  All specialists
                </button>
              </>
            )}
          </div>
        </>
      );
    }
    return (
      <AgentDetail
        blob={blob}
        {...(view.note ? { note: view.note } : {})}
        onBack={toList}
        onEdit={() => setView({ kind: "edit", id: blob.id })}
        onChanged={load}
        onDeleted={() => {
          toList();
          void load();
        }}
      />
    );
  }

  return (
    <AgentList
      blobs={blobs}
      error={error}
      onClose={onClose}
      onCreate={() => setView({ kind: "create" })}
      onOpen={(id) => setView({ kind: "detail", id })}
      {...(onOpenApps ? { onOpenApps } : {})}
    />
  );
}

// ─── the list ─────────────────────────────────────────────────────────────────────────

function AgentList({
  blobs,
  error,
  onClose,
  onCreate,
  onOpen,
  onOpenApps,
}: {
  blobs: Blob[] | null;
  error: string | null;
  onClose: () => void;
  onCreate: () => void;
  onOpen: (id: string) => void;
  onOpenApps?: () => void;
}): React.ReactElement {
  const [query, setQuery] = useState("");
  const windowFocused = useWindowFocused();
  const working = blobs?.filter((b) => b.running).length ?? 0;
  const q = query.trim().toLowerCase();
  const shown = (blobs ?? []).filter(
    (b) => !q || b.name.toLowerCase().includes(q) || b.job.toLowerCase().includes(q),
  );
  const loading = blobs === null && !error;

  return (
    <>
      <KleioHead
        onBack={onClose}
        title="Specialists"
        status={
          blobs !== null && (
            <>
              <Badge>{blobs.length}</Badge>
              {working > 0 && <Badge color={theme.success}>{`${working} working`}</Badge>}
              {blobs.length > 0 && (
                <input
                  type="search"
                  className="picker-search"
                  placeholder={"Search specialists\u2026"}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  aria-label="Search specialists"
                />
              )}
            </>
          )
        }
        actions={
          <>
            {onOpenApps && <AppsButton onClick={onOpenApps} />}
            <MetalButton
              windowFocused={windowFocused}
              className="btn btn-primary btn-sm"
              onClick={onCreate}
            >
              + New specialist
            </MetalButton>
          </>
        }
      />

      <div className="picker-list kleio-list-scroll">
        {loading && <ListSkeleton rows={4} />}
        {error && (
          <p className="kleio-error" role="alert">
            {error}
          </p>
        )}
        {blobs !== null && blobs.length === 0 && (
          <div className="picker-empty kleio-first">
            <BlobAvatar look={{ shape: "orb", face: "happy", color: "sky" }} size={64} animated />
            <h2 className="kleio-first-title">No specialists yet</h2>
            <p className="kleio-first-text" style={{ color: theme.textMuted }}>
              A specialist does one job for you on your Mac mini — on a schedule or when you ask —
              and shares Kleio's memory of you.
            </p>
            <MetalButton
              windowFocused={windowFocused}
              className="btn btn-primary btn-sm"
              onClick={onCreate}
            >
              + Create your first specialist
            </MetalButton>
          </div>
        )}
        {blobs !== null && blobs.length > 0 && shown.length === 0 && (
          <div className="picker-empty" style={{ color: theme.textMuted }}>
            No specialists match “{query.trim()}”.
          </div>
        )}
        {shown.length > 0 && (
          <div className="picker-reveal">
            {shown.map((b) => {
              const state = agentRowState(b);
              return (
                <button
                  key={b.id}
                  type="button"
                  className={`picker-item kleio-row${b.running ? " is-running" : ""}`}
                  onClick={() => onOpen(b.id)}
                  aria-label={`${b.name}. ${state.text}. ${b.job}`}
                >
                  <AgentRowContent
                    name={b.name}
                    avatar={<AgentAvatar agent={b} live={b.running} />}
                    sub={b.job}
                    state={state}
                  />
                </button>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}

// ─── one agent ────────────────────────────────────────────────────────────

function AgentDetail({
  blob,
  note,
  onBack,
  onEdit,
  onChanged,
  onDeleted,
}: {
  blob: Blob;
  note?: string;
  onBack: () => void;
  onEdit: () => void;
  onChanged: () => Promise<void>;
  onDeleted: () => void;
}): React.ReactElement {
  const sidebar = useSidebar();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmNew, setConfirmNew] = useState(false);
  const [starting, setStarting] = useState(false);
  // Bumped after a fresh conversation: the chat remounts onto the new pin.
  const [chatKey, setChatKey] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const sideId = useId();
  const resolve = useCallback(() => getBlobSession(blob.id), [blob.id]);
  const activity = useCallback(() => getBlobActivity(blob.id), [blob.id]);
  const owner = useMemo(() => fileOwner(blob.id), [blob.id]);
  const state = agentRowState(blob);
  // The files this specialist linked in the conversation, newest first.
  const [assets, setAssets] = useState<readonly Asset[]>([]);
  const onHistory = useCallback(
    (history: readonly HistoryEntry[]) =>
      setAssets(
        collectAssets(
          history,
          (m) => (m.role === "assistant" ? owner : null),
          () => blob.name,
        ),
      ),
    [owner, blob.name],
  );

  async function remove(): Promise<void> {
    setDeleting(true);
    try {
      await deleteBlob(blob.id);
      onDeleted();
    } catch (e) {
      setError(errorText(e));
      setDeleting(false);
      setConfirmDelete(false);
    }
  }

  async function startFresh(): Promise<void> {
    setStarting(true);
    setError(null);
    try {
      await newBlobSession(blob.id);
      setAssets([]);
      setChatKey((k) => k + 1);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setStarting(false);
      setConfirmNew(false);
    }
  }

  const side = (
    <>
      <KleioPanel
        title="Job"
        action={
          <button type="button" className="kleio-text-btn" onClick={onEdit}>
            <PencilSimpleIcon size={12} weight="bold" aria-hidden="true" />
            Edit
          </button>
        }
      >
        <p className="kleio-job-text">{blob.job}</p>
      </KleioPanel>
      <AssetsPanel assets={assets} onError={setError} />
      <Schedules blob={blob} onChanged={onChanged} />
      <KleioPanel
        title="Delete specialist"
        description="Removes it with its schedules and run history."
      >
        <button
          type="button"
          className="btn btn-ghost btn-sm kleio-danger-btn"
          onClick={() => setConfirmDelete(true)}
          aria-label={`Delete ${blob.name}`}
        >
          <TrashIcon size={14} weight="bold" aria-hidden="true" />
          Delete
        </button>
      </KleioPanel>
    </>
  );

  return (
    <>
      <KleioHead
        onBack={onBack}
        tools={
          <>
            <SideToggle sidebar={sidebar} controls={sideId} />
            <NewChatButton onClick={() => setConfirmNew(true)} disabled={starting} />
          </>
        }
        leading={<AgentAvatar agent={blob} size={28} live={blob.running} />}
        title={blob.name}
        subtitle={<Badge className={`kleio-state is-${state.tone}`}>{state.text}</Badge>}
        actions={
          <button type="button" className="btn btn-ghost btn-sm" onClick={onEdit}>
            <PencilSimpleIcon size={14} weight="bold" aria-hidden="true" />
            Edit
          </button>
        }
      />
      {note && <p className="kleio-note kleio-page-note">{note}</p>}
      {error && (
        <p className="kleio-error kleio-page-error" role="alert">
          {error}
        </p>
      )}
      <KleioSplit
        main={
          <ThreadChat
            key={chatKey}
            label={blob.name}
            resolve={resolve}
            owner={owner}
            onHistory={onHistory}
            activity={activity}
            intro={
              <div className="kleio-chat-intro">
                <AgentAvatar agent={blob} size={72} animated />
                <p className="kleio-chat-intro-name">{blob.name}</p>
                <p className="kleio-chat-intro-job">{blob.job}</p>
                <p className="kleio-chat-hint">
                  Ask it anything about its job. This chat is shared with your phone.
                </p>
              </div>
            }
          />
        }
        side={side}
        sideId={sideId}
        sideLabel={`${blob.name} details`}
        sidebar={sidebar}
      />
      {confirmDelete && (
        <ConfirmModal
          title={`Delete ${blob.name}?`}
          message="Its schedules and run history go too. This can't be undone."
          confirmLabel="Delete"
          busy={deleting}
          onConfirm={() => void remove()}
          onClose={() => setConfirmDelete(false)}
        />
      )}
      {confirmNew && (
        <ConfirmModal
          title="Start a new conversation?"
          message={`Every device switches to a fresh conversation with ${blob.name}. The old one stays on your Mac mini.`}
          confirmLabel="New conversation"
          busy={starting}
          onConfirm={() => void startFresh()}
          onClose={() => setConfirmNew(false)}
        />
      )}
    </>
  );
}

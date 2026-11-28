// Specialists (Blobs in the code): Kleio's helpers, each with one job. The list
// is a cast on a shelf (CastList.tsx). A specialist opens into its chat with a
// sidebar of cards on the left (job, schedules, recent activity) that collapses
// from the header. New and edit are the Cast's full-page form (CastForm.tsx).
// Every change goes to the Mac mini, so every device sees it.

import { useCallback, useEffect, useId, useMemo, useState } from "react";
import { PencilSimpleIcon, TrashIcon } from "@phosphor-icons/react";
import { Badge } from "../Badge";
import { ConfirmModal } from "../ConfirmModal";
import { theme } from "../theme";
import { agentRowState } from "./AgentRow";
import { AgentAvatar } from "./BlobAvatar";
import { Schedules } from "./BlobSchedules";
import { describeAutoSchedules } from "./blobFormat";
import { CastForm } from "./CastForm";
import { CastList } from "./CastList";
import { ClampText } from "./ClampText";
import { shortHost } from "./host-name";
import {
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
import { useKleioRemote } from "./useKleioRemote";

const REFRESH_MS = 10_000;

type View =
  | { kind: "list" }
  | { kind: "create"; job?: string }
  | { kind: "edit"; id: string }
  | { kind: "detail"; id: string; note?: string };

export function BlobsPage({
  onClose,
  onListChange,
  onCountChange,
  onOpenApps,
  openId,
}: {
  /** Leave Specialists (Back on the list). */
  onClose: () => void;
  /** Told whether the list is showing, so the screen can show its switcher. */
  onListChange?: (atList: boolean) => void;
  /** Told how many specialists there are (null until read): none yet means no groups yet. */
  onCountChange?: (count: number | null) => void;
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

  const count = blobs?.length ?? null;
  useEffect(() => {
    onCountChange?.(count);
  }, [count, onCountChange]);

  function saved(r: BlobSaved): void {
    void load();
    const note = describeAutoSchedules(r.autoSchedules);
    setView({ kind: "detail", id: r.blob.id, ...(note ? { note } : {}) });
  }

  const byId = (id: string): Blob | undefined => blobs?.find((b) => b.id === id);
  const toList = (): void => setView({ kind: "list" });

  if (view.kind === "create" || view.kind === "edit") {
    const blob = view.kind === "edit" ? byId(view.id) : undefined;
    const form = {
      ...(blob ? { blob } : {}),
      others: (blobs ?? []).filter((b) => b.id !== blob?.id),
      onSaved: saved,
      onCancel: () => setView(blob ? { kind: "detail", id: blob.id } : { kind: "list" }),
    };
    const startJob = view.kind === "create" ? view.job : undefined;
    return <CastForm {...form} {...(startJob ? { startJob } : {})} onChanged={load} />;
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
    <CastShelf
      blobs={blobs}
      error={error}
      onClose={onClose}
      onCreate={() => setView({ kind: "create" })}
      onCreateFrom={(job) => setView({ kind: "create", job })}
      onChanged={load}
      onOpen={(id) => setView({ kind: "detail", id })}
      onEdit={(id) => setView({ kind: "edit", id })}
      {...(onOpenApps ? { onOpenApps } : {})}
    />
  );
}

interface ListProps {
  blobs: Blob[] | null;
  error: string | null;
  onClose: () => void;
  onCreate: () => void;
  /** The first run: a new specialist starting from an example job. */
  onCreateFrom: (job: string) => void;
  /** The profile changed something on the host: read the list again. */
  onChanged: () => Promise<void>;
  onOpen: (id: string) => void;
  onEdit: (id: string) => void;
  onOpenApps?: () => void;
}

/** The cast, told which host the specialists work on. */
function CastShelf(props: ListProps): React.ReactElement {
  const host = useKleioRemote().status?.active?.host;
  return <CastList {...props} hostLabel={host ? shortHost(host) : "your host"} />;
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
        <ClampText key={blob.id} className="kleio-job-text">
          {blob.job}
        </ClampText>
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
        phoneMenu={[
          { label: sidebar.open ? "Hide sidebar" : "Show sidebar", onSelect: sidebar.toggle },
          { label: "New conversation", onSelect: () => setConfirmNew(true), disabled: starting },
          { label: "Edit", onSelect: onEdit },
        ]}
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
                <ClampText key={blob.id} className="kleio-chat-intro-job">
                  {blob.job}
                </ClampText>
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
          message={`Every device switches to a fresh conversation with ${blob.name}. The old one stays on your host.`}
          confirmLabel="New conversation"
          busy={starting}
          onConfirm={() => void startFresh()}
          onClose={() => setConfirmNew(false)}
        />
      )}
    </>
  );
}

// Blobs: Kleio's little helpers, each with one job. A gallery of Blob cards;
// a Blob opens into its own profile — a chat with it, its schedules and what
// it has done lately. New and edit are full forms in a card, not a cramped
// modal. Every change goes to the Mac mini, so the phone sees it too.

import { useCallback, useEffect, useState } from "react";
import {
  ArrowLeftIcon,
  CalendarBlankIcon,
  ChatCircleIcon,
  ClockCountdownIcon,
  PencilSimpleIcon,
  PlusIcon,
  TrashIcon,
} from "@phosphor-icons/react";
import { Badge } from "../Badge";
import { SettingsCard } from "../settings-section";
import { SettingsHeaderAction, SettingsHeaderStatus } from "../settings-header";
import { theme } from "../theme";
import { BlobForm } from "./BlobForm";
import { Schedules } from "./BlobSchedules";
import { BLOB_COLOR_HEX, describeAutoSchedules, formatWhen, nextRun } from "./blobFormat";
import {
  deleteBlob,
  errorText,
  getBlobSession,
  listBlobs,
  newBlobSession,
  type Blob,
  type BlobColor,
  type BlobSaved,
} from "./kleioApi";
import { ThreadChat } from "./ThreadChat";

const REFRESH_MS = 10_000;

type View =
  | { kind: "list" }
  | { kind: "create" }
  | { kind: "edit"; id: string }
  | { kind: "detail"; id: string; note?: string };

export function BlobFace({
  emoji,
  color,
  size = 44,
}: {
  emoji: string;
  color: BlobColor;
  size?: number;
}): React.ReactElement {
  return (
    <span
      className="blob-face"
      aria-hidden="true"
      style={{
        width: size,
        height: size,
        fontSize: Math.round(size * 0.5),
        ["--blob-color" as string]: BLOB_COLOR_HEX[color],
      }}
    >
      {emoji}
    </span>
  );
}

/** One line on what a Blob is up to: working, next run, or idle. */
export function blobStatus(blob: Blob): string {
  if (blob.running) return "Working now";
  const next = nextRun(blob.schedules);
  if (next) return `Next ${formatWhen(next)}`;
  return blob.schedules.length > 0 ? "Schedules paused" : "On call — no schedule";
}

export function BlobsPage(): React.ReactElement {
  const [blobs, setBlobs] = useState<Blob[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<View>({ kind: "list" });

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

  function saved(r: BlobSaved): void {
    void load();
    const note = describeAutoSchedules(r.autoSchedules);
    setView({ kind: "detail", id: r.blob.id, ...(note ? { note } : {}) });
  }

  const working = blobs?.filter((b) => b.running).length ?? 0;
  const byId = (id: string): Blob | undefined => blobs?.find((b) => b.id === id);

  if (view.kind === "create" || view.kind === "edit") {
    const blob = view.kind === "edit" ? byId(view.id) : undefined;
    return (
      <div className="blob-editor">
        <SettingsCard
          title={blob ? `Edit ${blob.name}` : "New agent"}
          description={
            blob
              ? "Change its name, look, job or brain."
              : "Give it a name and one job. Timing in the job (“every weekday at 7:30”) becomes a schedule."
          }
        >
          <BlobForm
            {...(blob ? { blob } : {})}
            heading={false}
            onSaved={saved}
            onCancel={() => setView(blob ? { kind: "detail", id: blob.id } : { kind: "list" })}
          />
        </SettingsCard>
      </div>
    );
  }

  if (view.kind === "detail") {
    const blob = byId(view.id);
    if (!blob) {
      return blobs === null ? (
        <p className="blob-empty-line">Loading…</p>
      ) : (
        <p className="blob-empty-line">
          That agent no longer exists.{" "}
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => setView({ kind: "list" })}
          >
            All agents
          </button>
        </p>
      );
    }
    return (
      <BlobProfile
        blob={blob}
        {...(view.note ? { note: view.note } : {})}
        onBack={() => setView({ kind: "list" })}
        onEdit={() => setView({ kind: "edit", id: blob.id })}
        onChanged={load}
        onDeleted={() => {
          setView({ kind: "list" });
          void load();
        }}
      />
    );
  }

  return (
    <>
      <SettingsHeaderStatus>
        {blobs !== null && (
          <Badge color={working > 0 ? theme.success : undefined}>
            {working > 0
              ? `${working} working`
              : `${blobs.length} agent${blobs.length === 1 ? "" : "s"}`}
          </Badge>
        )}
      </SettingsHeaderStatus>
      <SettingsHeaderAction>
        <button
          type="button"
          className="btn btn-primary btn-sm"
          onClick={() => setView({ kind: "create" })}
        >
          <PlusIcon size={14} weight="bold" aria-hidden="true" />
          New agent
        </button>
      </SettingsHeaderAction>

      <p className="kleio-page-intro">
        Each agent does one job for you. They run on your Mac mini, on a schedule or when you ask,
        and share Kleio's memory of you.
      </p>

      {error && (
        <p className="kleio-error" role="alert">
          {error}
        </p>
      )}

      {blobs === null && !error ? (
        <div className="blob-grid" aria-hidden="true">
          {[0, 1, 2].map((i) => (
            <div key={i} className="blob-card blob-card-skeleton" />
          ))}
        </div>
      ) : blobs !== null && blobs.length === 0 ? (
        <div className="blob-empty">
          <BlobFace emoji="🫧" color="sky" size={64} />
          <h2>No agents yet</h2>
          <p>
            Make one and tell it what to do — “Send me the AI news every morning at 8”, “Plan three
            dinners every Sunday”.
          </p>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => setView({ kind: "create" })}
          >
            <PlusIcon size={16} weight="bold" aria-hidden="true" />
            Create your first agent
          </button>
        </div>
      ) : (
        <div className="blob-grid">
          {(blobs ?? []).map((b) => (
            <button
              key={b.id}
              type="button"
              className={`blob-card${b.running ? " is-running" : ""}`}
              style={{ ["--blob-color" as string]: BLOB_COLOR_HEX[b.color] }}
              onClick={() => setView({ kind: "detail", id: b.id })}
              aria-label={`${b.name}. ${b.job}. ${blobStatus(b)}`}
            >
              <span className="blob-card-top">
                <BlobFace emoji={b.emoji} color={b.color} />
                <span className="blob-card-title">
                  <span className="blob-card-name">{b.name}</span>
                  <span className="blob-card-status">
                    {b.running && <span className="blob-pulse" aria-hidden="true" />}
                    {blobStatus(b)}
                  </span>
                </span>
              </span>
              <span className="blob-card-job">{b.job}</span>
              <span className="blob-card-foot">
                <span>
                  <CalendarBlankIcon size={13} weight="bold" aria-hidden="true" />
                  {b.schedules.length === 0
                    ? "No schedule"
                    : `${b.schedules.length} schedule${b.schedules.length === 1 ? "" : "s"}`}
                </span>
                {b.lastRun?.endedAt && (
                  <span className={`blob-last is-${b.lastRun.outcome}`}>
                    <ClockCountdownIcon size={13} weight="bold" aria-hidden="true" />
                    {b.lastRun.outcome === "error"
                      ? "Last run failed"
                      : `Ran ${formatWhen(b.lastRun.endedAt)}`}
                  </span>
                )}
              </span>
            </button>
          ))}
          <button
            type="button"
            className="blob-card blob-card-new"
            onClick={() => setView({ kind: "create" })}
          >
            <span className="blob-card-new-plus" aria-hidden="true">
              <PlusIcon size={20} weight="bold" />
            </span>
            <span className="blob-card-new-label">Create an agent</span>
          </button>
        </div>
      )}
    </>
  );
}

// ─── one Blob ─────────────────────────────────────────────────────────────

type ProfileTab = "chat" | "schedules";

function BlobProfile({
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
  const [tab, setTab] = useState<ProfileTab>(note ? "schedules" : "chat");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const resolve = useCallback(() => getBlobSession(blob.id), [blob.id]);
  const startNew = useCallback(() => newBlobSession(blob.id), [blob.id]);

  async function remove(): Promise<void> {
    setDeleting(true);
    try {
      await deleteBlob(blob.id);
      onDeleted();
    } catch (e) {
      setError(errorText(e));
      setDeleting(false);
    }
  }

  return (
    <div
      className="blob-profile"
      style={{ ["--blob-color" as string]: BLOB_COLOR_HEX[blob.color] }}
    >
      <SettingsHeaderAction>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onBack}>
          <ArrowLeftIcon size={14} weight="bold" aria-hidden="true" />
          All agents
        </button>
      </SettingsHeaderAction>

      <section className="blob-profile-head" aria-label={blob.name}>
        <BlobFace emoji={blob.emoji} color={blob.color} size={72} />
        <div className="blob-profile-text">
          <h2 className="blob-profile-name">{blob.name}</h2>
          <p className="blob-profile-status">
            {blob.running && <span className="blob-pulse" aria-hidden="true" />}
            {blobStatus(blob)}
          </p>
          <p className="blob-profile-job">{blob.job}</p>
        </div>
        <div className="blob-profile-actions">
          <button type="button" className="btn btn-ghost btn-sm" onClick={onEdit}>
            <PencilSimpleIcon size={14} weight="bold" aria-hidden="true" />
            Edit
          </button>
          {confirmDelete ? (
            <span className="blob-confirm" role="group" aria-label={`Delete ${blob.name}?`}>
              <span>Delete {blob.name}?</span>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => setConfirmDelete(false)}
                disabled={deleting}
              >
                Keep
              </button>
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={() => void remove()}
                disabled={deleting}
              >
                {deleting ? "Deleting…" : "Delete"}
              </button>
            </span>
          ) : (
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => setConfirmDelete(true)}
              aria-label={`Delete ${blob.name}`}
            >
              <TrashIcon size={14} weight="bold" aria-hidden="true" />
              Delete
            </button>
          )}
        </div>
      </section>

      {note && <p className="kleio-note">{note}</p>}
      {error && (
        <p className="kleio-error" role="alert">
          {error}
        </p>
      )}

      <div className="kleio-segments" role="tablist" aria-label={`${blob.name} sections`}>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "chat"}
          onClick={() => setTab("chat")}
        >
          <ChatCircleIcon size={15} weight="bold" aria-hidden="true" />
          Chat
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "schedules"}
          onClick={() => setTab("schedules")}
        >
          <CalendarBlankIcon size={15} weight="bold" aria-hidden="true" />
          Schedules &amp; activity
          <span className="kleio-count">{blob.schedules.length}</span>
        </button>
      </div>

      <div className="blob-profile-panel">
        {tab === "chat" ? (
          <ThreadChat label={blob.name} resolve={resolve} startNew={startNew} />
        ) : (
          <Schedules blob={blob} onChanged={onChanged} />
        )}
      </div>
    </div>
  );
}

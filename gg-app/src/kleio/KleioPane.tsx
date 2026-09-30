// The Kleio pane: the same Kleio thread, Blobs, group chats and apps the
// phone shows, straight from the Kleio host (so every device is in sync).
// Only reachable in remote mode; every call goes through the allow-listed,
// device-authenticated `kleio_api` command.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Modal } from "../Modal";
import { theme } from "../theme";
import { BlobForm } from "./BlobForm";
import {
  BLOB_COLOR_HEX,
  describeAutoSchedules,
  describeSchedule,
  formatWhen,
  nextRun,
  systemTimezone,
} from "./blobFormat";
import {
  BLOB_COLORS,
  addSchedule,
  connectToolkit,
  createGroup,
  deleteBlob,
  deleteGroup,
  deleteSchedule,
  disconnect,
  getBlobSession,
  getHome,
  listBlobs,
  listConnections,
  listGroupMessages,
  listGroups,
  listRuns,
  listToolkits,
  newBlobSession,
  newHome,
  runScheduleNow,
  sendGroupMessage,
  updateGroup,
  updateSchedule,
  type Blob,
  type BlobColor,
  type BlobSaved,
  type Connection,
  type Group,
  type GroupMessage,
  type Run,
  type Schedule,
  type ScheduleInput,
  type ScheduleKind,
  type Toolkit,
} from "./kleioApi";
import { ThreadChat, errorText } from "./ThreadChat";

export type KleioTab = "kleio" | "blobs" | "groups" | "apps";
type Tab = KleioTab;
const TABS: { id: Tab; label: string }[] = [
  { id: "kleio", label: "Kleio" },
  { id: "blobs", label: "Blobs" },
  { id: "groups", label: "Groups" },
  { id: "apps", label: "Apps" },
];

export function KleioPane({
  onClose,
  initialTab = "kleio",
}: {
  onClose: () => void;
  initialTab?: KleioTab;
}): React.ReactElement {
  const [tab, setTab] = useState<Tab>(initialTab);
  return (
    <Modal
      title={
        <span className="kleio-title">
          <span>Kleio</span>
          <span className="brain-tabs" role="tablist" aria-label="Kleio sections">
            {TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                role="tab"
                id={`kleio-pane-tab-${t.id}`}
                aria-selected={tab === t.id}
                aria-controls="kleio-pane-panel"
                tabIndex={tab === t.id ? 0 : -1}
                onClick={() => setTab(t.id)}
              >
                {t.label}
              </button>
            ))}
          </span>
        </span>
      }
      onClose={onClose}
      className="kleio-pane"
    >
      <div
        id="kleio-pane-panel"
        role="tabpanel"
        aria-labelledby={`kleio-pane-tab-${tab}`}
        className="kleio-pane-body"
      >
        {tab === "kleio" && <ThreadChat label="Kleio" resolve={getHome} startNew={newHome} />}
        {tab === "blobs" && <BlobsTab />}
        {tab === "groups" && <GroupsTab />}
        {tab === "apps" && <AppsTab />}
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------- shared bits

function Face({
  emoji,
  color,
  size = 32,
}: {
  emoji: string;
  color: BlobColor;
  size?: number;
}): React.ReactElement {
  return (
    <span
      className="kleio-face"
      aria-hidden="true"
      style={{
        width: size,
        height: size,
        fontSize: size * 0.55,
        background: BLOB_COLOR_HEX[color],
      }}
    >
      {emoji}
    </span>
  );
}

function ErrorLine({ error }: { error: string | null }): React.ReactElement | null {
  return error ? (
    <p className="kleio-error" role="alert">
      {error}
    </p>
  ) : null;
}

// ---------------------------------------------------------------- Blobs

type BlobView =
  | { kind: "list" }
  | { kind: "create" }
  | { kind: "edit"; blob: Blob }
  | { kind: "detail"; id: string; saved?: string };

function BlobsTab(): React.ReactElement {
  const [blobs, setBlobs] = useState<Blob[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<BlobView>({ kind: "list" });

  const load = useCallback(async () => {
    try {
      setBlobs(await listBlobs());
      setError(null);
    } catch (e) {
      setError(errorText(e));
    }
  }, []);
  useEffect(() => {
    void load();
    const id = window.setInterval(() => void load(), 10_000);
    return () => window.clearInterval(id);
  }, [load]);

  function saved(r: BlobSaved): void {
    void load();
    const note = describeAutoSchedules(r.autoSchedules);
    setView({ kind: "detail", id: r.blob.id, ...(note ? { saved: note } : {}) });
  }

  if (view.kind === "create")
    return (
      <div className="kleio-section">
        <h3 className="kleio-h3">New Blob</h3>
        <BlobForm onSaved={saved} onCancel={() => setView({ kind: "list" })} />
      </div>
    );
  if (view.kind === "edit")
    return (
      <div className="kleio-section">
        <h3 className="kleio-h3">Edit {view.blob.name}</h3>
        <BlobForm
          blob={view.blob}
          onSaved={saved}
          onCancel={() => setView({ kind: "detail", id: view.blob.id })}
        />
      </div>
    );
  if (view.kind === "detail") {
    const blob = blobs?.find((b) => b.id === view.id);
    if (!blob) return <p className="modal-hint">Loading…</p>;
    return (
      <BlobDetail
        blob={blob}
        note={view.saved}
        onBack={() => setView({ kind: "list" })}
        onEdit={() => setView({ kind: "edit", blob })}
        onChanged={load}
        onDeleted={() => {
          setView({ kind: "list" });
          void load();
        }}
      />
    );
  }

  return (
    <div className="kleio-section">
      <div className="kleio-row-between">
        <p className="modal-hint" style={{ color: theme.textMuted, margin: 0 }}>
          Little helpers with one job each. They share Kleio's memory of you.
        </p>
        <button
          type="button"
          className="btn btn-primary btn-sm"
          onClick={() => setView({ kind: "create" })}
        >
          New Blob
        </button>
      </div>
      <ErrorLine error={error} />
      {blobs === null ? (
        <p className="modal-hint">Loading…</p>
      ) : blobs.length === 0 ? (
        <p className="kleio-empty">No Blobs yet. Make one and tell it what to do.</p>
      ) : (
        <div className="kleio-grid">
          {blobs.map((b) => (
            <button
              key={b.id}
              type="button"
              className="kleio-card"
              onClick={() => setView({ kind: "detail", id: b.id })}
              aria-label={`${b.name}. ${b.job}`}
            >
              <span className="kleio-card-top">
                <Face emoji={b.emoji} color={b.color} />
                <span className="kleio-card-name">{b.name}</span>
                {b.running && <span className="kleio-dot" title="Working" aria-label="Working" />}
              </span>
              <span className="kleio-card-job">{b.job}</span>
              <span className="kleio-card-next">
                {nextRun(b.schedules)
                  ? `Next: ${formatWhen(nextRun(b.schedules)!)}`
                  : "No schedule"}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function BlobDetail({
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
  const [sub, setSub] = useState<"chat" | "schedules">(note ? "schedules" : "chat");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const resolve = useCallback(() => getBlobSession(blob.id), [blob.id]);
  const startNew = useCallback(() => newBlobSession(blob.id), [blob.id]);

  return (
    <div className="kleio-section">
      <div className="kleio-row-between">
        <button type="button" className="btn btn-ghost btn-sm" onClick={onBack}>
          ← All Blobs
        </button>
        <span className="kleio-inline">
          <button type="button" className="btn btn-ghost btn-sm" onClick={onEdit}>
            Edit
          </button>
          {confirmDelete ? (
            <span className="kleio-inline-confirm">
              Delete {blob.name}?
              <button
                type="button"
                className="btn btn-sm"
                onClick={() =>
                  void deleteBlob(blob.id).then(onDeleted, (e) => setError(errorText(e)))
                }
              >
                Delete
              </button>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => setConfirmDelete(false)}
              >
                Keep
              </button>
            </span>
          ) : (
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => setConfirmDelete(true)}
            >
              Delete
            </button>
          )}
        </span>
      </div>
      <div className="kleio-row">
        <Face emoji={blob.emoji} color={blob.color} size={40} />
        <div>
          <h3 className="kleio-h3" style={{ margin: 0 }}>
            {blob.name}
          </h3>
          <p className="kleio-card-job" style={{ margin: 0 }}>
            {blob.job}
          </p>
        </div>
      </div>
      {note && <p className="kleio-note">{note}</p>}
      <ErrorLine error={error} />
      <div className="kleio-subtabs" role="tablist" aria-label={`${blob.name} sections`}>
        <button
          type="button"
          role="tab"
          aria-selected={sub === "chat"}
          onClick={() => setSub("chat")}
        >
          Chat
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={sub === "schedules"}
          onClick={() => setSub("schedules")}
        >
          Schedules ({blob.schedules.length})
        </button>
      </div>
      {sub === "chat" ? (
        <ThreadChat label={blob.name} resolve={resolve} startNew={startNew} />
      ) : (
        <Schedules blob={blob} onChanged={onChanged} />
      )}
    </div>
  );
}

// ---------------------------------------------------------------- schedules

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const INTERVALS: { minutes: number; label: string }[] = [
  { minutes: 15, label: "15 minutes" },
  { minutes: 30, label: "30 minutes" },
  { minutes: 60, label: "hour" },
  { minutes: 120, label: "2 hours" },
  { minutes: 240, label: "4 hours" },
  { minutes: 360, label: "6 hours" },
  { minutes: 720, label: "12 hours" },
];

function Schedules({
  blob,
  onChanged,
}: {
  blob: Blob;
  onChanged: () => Promise<void>;
}): React.ReactElement {
  const [runs, setRuns] = useState<Run[] | null>(null);
  const [editing, setEditing] = useState<Schedule | "new" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  const loadRuns = useCallback(async () => {
    try {
      setRuns(await listRuns(blob.id));
    } catch (e) {
      setError(errorText(e));
    }
  }, [blob.id]);
  useEffect(() => {
    void loadRuns();
    const id = window.setInterval(() => void loadRuns(), 8_000);
    return () => window.clearInterval(id);
  }, [loadRuns]);

  async function act(work: () => Promise<unknown>, done?: string): Promise<void> {
    setError(null);
    try {
      await work();
      await onChanged();
      await loadRuns();
      if (done) {
        setFlash(done);
        window.setTimeout(() => setFlash(null), 2500);
      }
    } catch (e) {
      setError(errorText(e));
    }
  }

  if (editing)
    return (
      <ScheduleForm
        schedule={editing === "new" ? undefined : editing}
        onCancel={() => setEditing(null)}
        onSave={async (input) => {
          await (editing === "new"
            ? addSchedule(blob.id, input)
            : updateSchedule(blob.id, editing.id, input));
          setEditing(null);
          await onChanged();
        }}
      />
    );

  return (
    <div className="kleio-section">
      <ErrorLine error={error} />
      {flash && <p className="kleio-note">{flash}</p>}
      {blob.schedules.length === 0 ? (
        <p className="kleio-empty">
          No schedules. Mention timing in the job (e.g. “every weekday at 7:30”) or add one.
        </p>
      ) : (
        <ul className="kleio-list">
          {blob.schedules.map((s) => (
            <li key={s.id} className="kleio-list-row">
              <div className="kleio-list-main">
                <span className="kleio-list-title">
                  {s.label}
                  {s.source === "auto" && <span className="kleio-tag">Auto</span>}
                </span>
                <span className="kleio-list-sub">
                  {describeSchedule(s)}
                  {s.enabled && s.nextRunAt ? ` · Next: ${formatWhen(s.nextRunAt)}` : ""}
                </span>
              </div>
              <label className="kleio-toggle">
                <input
                  type="checkbox"
                  checked={s.enabled}
                  onChange={(e) =>
                    void act(() => updateSchedule(blob.id, s.id, { enabled: e.target.checked }))
                  }
                  aria-label={`${s.label} on`}
                />
                On
              </label>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() =>
                  void act(
                    () => runScheduleNow(blob.id, s.id),
                    "Started — the result will show below.",
                  )
                }
              >
                Run now
              </button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditing(s)}>
                Edit
              </button>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                aria-label={`Delete ${s.label}`}
                onClick={() => void act(() => deleteSchedule(blob.id, s.id))}
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}
      <button type="button" className="btn btn-sm" onClick={() => setEditing("new")}>
        Add schedule
      </button>
      <h4 className="kleio-h4">Recent runs</h4>
      {runs === null ? (
        <p className="modal-hint">Loading…</p>
      ) : runs.length === 0 ? (
        <p className="kleio-empty">Nothing has run yet.</p>
      ) : (
        <ul className="kleio-list">
          {runs.slice(0, 15).map((r) => (
            <li key={r.id} className="kleio-list-row">
              <span className={`kleio-outcome ${r.outcome}`} aria-label={r.outcome}>
                {r.endedAt ? (r.outcome === "ok" ? "✓" : r.outcome === "error" ? "!" : "→") : "…"}
              </span>
              <div className="kleio-list-main">
                <span className="kleio-list-title">
                  {r.label} <span className="kleio-list-sub">· {formatWhen(r.startedAt)}</span>
                </span>
                {(r.summary || r.error) && (
                  <span className="kleio-list-sub kleio-clamp">{r.summary ?? r.error}</span>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ScheduleForm({
  schedule,
  onSave,
  onCancel,
}: {
  schedule?: Schedule;
  onSave: (input: ScheduleInput) => Promise<void>;
  onCancel: () => void;
}): React.ReactElement {
  const [label, setLabel] = useState(schedule?.label ?? "");
  const [prompt, setPrompt] = useState(schedule?.prompt ?? "");
  const [kind, setKind] = useState<ScheduleKind>(schedule?.kind ?? "daily");
  const [every, setEvery] = useState(schedule?.everyMinutes ?? 60);
  const [time, setTime] = useState(schedule?.time ?? "08:00");
  const [days, setDays] = useState<number[]>(schedule?.days ?? [1, 2, 3, 4, 5]);
  const [at, setAt] = useState(() => {
    const d = schedule?.at ? new Date(schedule.at) : new Date(Date.now() + 3600_000);
    const p = (n: number): string => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
  });
  const [notify, setNotify] = useState(schedule?.notify ?? true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setSaving(true);
    setError(null);
    const timing: Partial<ScheduleInput> =
      kind === "interval"
        ? { everyMinutes: every }
        : kind === "daily"
          ? { time }
          : kind === "weekly"
            ? { time, days: [...days].sort() }
            : { at: new Date(at).toISOString() };
    try {
      await onSave({
        label: label.trim(),
        prompt: prompt.trim(),
        kind,
        timezone: schedule?.timezone ?? systemTimezone(),
        notify,
        ...timing,
      } as ScheduleInput);
    } catch (err) {
      setError(errorText(err));
      setSaving(false);
    }
  }

  return (
    <form className="kleio-form" onSubmit={(e) => void save(e)}>
      <label className="modal-label" htmlFor="kleio-s-label">
        Label
      </label>
      <input
        id="kleio-s-label"
        className="modal-input"
        value={label}
        maxLength={60}
        onChange={(e) => setLabel(e.target.value)}
        placeholder="Morning check-in"
      />
      <label className="modal-label" htmlFor="kleio-s-prompt">
        What to do
      </label>
      <textarea
        id="kleio-s-prompt"
        className="modal-input kleio-job"
        rows={3}
        value={prompt}
        maxLength={4000}
        onChange={(e) => setPrompt(e.target.value)}
        placeholder="Check today's London weather and tell me what to wear."
      />
      <span className="modal-label">When</span>
      <div className="kleio-subtabs" role="radiogroup" aria-label="Repeat">
        {(
          [
            ["interval", "Repeat every"],
            ["daily", "Daily"],
            ["weekly", "Weekly"],
            ["once", "Once"],
          ] as const
        ).map(([k, l]) => (
          <button
            key={k}
            type="button"
            role="radio"
            aria-checked={kind === k}
            onClick={() => setKind(k)}
          >
            {l}
          </button>
        ))}
      </div>
      {kind === "interval" && (
        <select
          className="modal-input"
          value={every}
          onChange={(e) => setEvery(Number(e.target.value))}
          aria-label="Every"
        >
          {INTERVALS.map((i) => (
            <option key={i.minutes} value={i.minutes}>
              Every {i.label}
            </option>
          ))}
        </select>
      )}
      {(kind === "daily" || kind === "weekly") && (
        <input
          type="time"
          className="modal-input"
          value={time}
          onChange={(e) => setTime(e.target.value)}
          aria-label="Time"
        />
      )}
      {kind === "weekly" && (
        <div className="kleio-chips" role="group" aria-label="Days">
          {DAY_NAMES.map((d, i) => (
            <button
              key={d}
              type="button"
              className="kleio-chip"
              aria-pressed={days.includes(i)}
              onClick={() =>
                setDays((cur) => (cur.includes(i) ? cur.filter((x) => x !== i) : [...cur, i]))
              }
            >
              {d}
            </button>
          ))}
        </div>
      )}
      {kind === "once" && (
        <input
          type="datetime-local"
          className="modal-input"
          value={at}
          onChange={(e) => setAt(e.target.value)}
          aria-label="Date and time"
        />
      )}
      <label className="kleio-toggle">
        <input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} />
        Send a notification with the result
      </label>
      <ErrorLine error={error} />
      <div className="modal-actions">
        <button type="button" className="modal-btn" onClick={onCancel} disabled={saving}>
          Cancel
        </button>
        <button
          type="submit"
          className="modal-btn primary"
          disabled={
            saving || !label.trim() || !prompt.trim() || (kind === "weekly" && days.length === 0)
          }
        >
          {saving ? "Saving…" : "Save"}
        </button>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------- Groups

function GroupsTab(): React.ReactElement {
  const [groups, setGroups] = useState<Group[] | null>(null);
  const [blobs, setBlobs] = useState<Blob[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const [editing, setEditing] = useState<Group | "new" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [g, b] = await Promise.all([listGroups(), listBlobs()]);
      setGroups(g);
      setBlobs(b);
      setError(null);
    } catch (e) {
      setError(errorText(e));
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  if (editing)
    return (
      <GroupForm
        group={editing === "new" ? undefined : editing}
        blobs={blobs}
        onCancel={() => setEditing(null)}
        onSaved={(g) => {
          setEditing(null);
          setOpen(g.id);
          void load();
        }}
        onDeleted={() => {
          setEditing(null);
          setOpen(null);
          void load();
        }}
      />
    );

  const current = groups?.find((g) => g.id === open);
  if (current)
    return (
      <GroupChat
        group={current}
        blobs={blobs}
        onBack={() => {
          setOpen(null);
          void load();
        }}
        onEdit={() => setEditing(current)}
      />
    );

  return (
    <div className="kleio-section">
      <div className="kleio-row-between">
        <p className="modal-hint" style={{ color: theme.textMuted, margin: 0 }}>
          Put Blobs in a room together. @mention one to ask just them.
        </p>
        <button
          type="button"
          className="btn btn-primary btn-sm"
          disabled={blobs.length === 0}
          title={blobs.length === 0 ? "Make a Blob first" : undefined}
          onClick={() => setEditing("new")}
        >
          New group
        </button>
      </div>
      <ErrorLine error={error} />
      {groups === null ? (
        <p className="modal-hint">Loading…</p>
      ) : groups.length === 0 ? (
        <p className="kleio-empty">No group chats yet.</p>
      ) : (
        <ul className="kleio-list">
          {groups.map((g) => (
            <li key={g.id}>
              <button
                type="button"
                className="kleio-list-row kleio-list-button"
                onClick={() => setOpen(g.id)}
              >
                <Face emoji={g.emoji} color={g.color} />
                <span className="kleio-list-main">
                  <span className="kleio-list-title">{g.name}</span>
                  <span className="kleio-list-sub kleio-clamp">
                    {g.typing.length
                      ? "Someone is typing…"
                      : g.lastMessage
                        ? `${g.lastMessage.authorName}: ${g.lastMessage.text}`
                        : `${g.members.length} member${g.members.length === 1 ? "" : "s"}`}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function GroupForm({
  group,
  blobs,
  onSaved,
  onCancel,
  onDeleted,
}: {
  group?: Group;
  blobs: Blob[];
  onSaved: (g: Group) => void;
  onCancel: () => void;
  onDeleted: () => void;
}): React.ReactElement {
  const [name, setName] = useState(group?.name ?? "");
  const [emoji, setEmoji] = useState(group?.emoji ?? "💬");
  const [color, setColor] = useState<BlobColor>(group?.color ?? "lilac");
  const [members, setMembers] = useState<string[]>(group?.members ?? []);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const input = { name: name.trim(), emoji: emoji.trim() || "💬", color, members };
      onSaved(group ? await updateGroup(group.id, input) : await createGroup(input));
    } catch (err) {
      setError(errorText(err));
      setSaving(false);
    }
  }

  return (
    <form className="kleio-form" onSubmit={(e) => void save(e)}>
      <h3 className="kleio-h3">{group ? `Edit ${group.name}` : "New group"}</h3>
      <label className="modal-label" htmlFor="kleio-g-name">
        Name
      </label>
      <input
        id="kleio-g-name"
        className="modal-input"
        value={name}
        maxLength={40}
        onChange={(e) => setName(e.target.value)}
        placeholder="Kitchen crew"
      />
      <div className="kleio-form-row">
        <label className="modal-label" htmlFor="kleio-g-emoji">
          Emoji
        </label>
        <input
          id="kleio-g-emoji"
          className="modal-input kleio-field-emoji"
          value={emoji}
          onChange={(e) => setEmoji([...e.target.value].slice(-1).join("") || "")}
        />
        <span className="kleio-swatches" role="radiogroup" aria-label="Colour">
          {BLOB_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              role="radio"
              aria-checked={color === c}
              aria-label={c}
              className="kleio-swatch"
              style={{ background: BLOB_COLOR_HEX[c] }}
              onClick={() => setColor(c)}
            />
          ))}
        </span>
      </div>
      <span className="modal-label">Members (1–8)</span>
      <div className="kleio-chips" role="group" aria-label="Members">
        {blobs.map((b) => (
          <button
            key={b.id}
            type="button"
            className="kleio-chip"
            aria-pressed={members.includes(b.id)}
            onClick={() =>
              setMembers((cur) =>
                cur.includes(b.id) ? cur.filter((x) => x !== b.id) : [...cur, b.id].slice(0, 8),
              )
            }
          >
            {b.emoji} {b.name}
          </button>
        ))}
      </div>
      <ErrorLine error={error} />
      <div className="modal-actions">
        {group &&
          (confirmDelete ? (
            <span className="kleio-inline-confirm">
              Delete this group?
              <button
                type="button"
                className="btn btn-sm"
                onClick={() =>
                  void deleteGroup(group.id).then(onDeleted, (err) => setError(errorText(err)))
                }
              >
                Delete
              </button>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => setConfirmDelete(false)}
              >
                Keep
              </button>
            </span>
          ) : (
            <button type="button" className="modal-btn" onClick={() => setConfirmDelete(true)}>
              Delete
            </button>
          ))}
        <button type="button" className="modal-btn" onClick={onCancel} disabled={saving}>
          Cancel
        </button>
        <button
          type="submit"
          className="modal-btn primary"
          disabled={saving || !name.trim() || members.length === 0}
        >
          {saving ? "Saving…" : group ? "Save" : "Create"}
        </button>
      </div>
    </form>
  );
}

const GROUP_POLL_MS = 1500;

function GroupChat({
  group,
  blobs,
  onBack,
  onEdit,
}: {
  group: Group;
  blobs: Blob[];
  onBack: () => void;
  onEdit: () => void;
}): React.ReactElement {
  const [messages, setMessages] = useState<GroupMessage[]>([]);
  const [typing, setTyping] = useState<string[]>([]);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const lastSeq = useRef(0);
  const logRef = useRef<HTMLDivElement>(null);
  const byId = useMemo(() => new Map(blobs.map((b) => [b.id, b])), [blobs]);
  const members = group.members.map((id) => byId.get(id)).filter((b): b is Blob => !!b);

  useEffect(() => {
    let live = true;
    lastSeq.current = 0;
    setMessages([]);
    const tick = async (): Promise<void> => {
      if (document.hidden) return;
      try {
        const page = await listGroupMessages(group.id, { after: lastSeq.current, limit: 200 });
        if (!live) return;
        if (page.messages.length) {
          lastSeq.current = page.lastSeq;
          setMessages((cur) => [...cur, ...page.messages]);
        }
        setTyping(page.typing);
        setError(null);
      } catch (e) {
        if (live) setError(errorText(e));
      }
    };
    void tick();
    const id = window.setInterval(() => void tick(), GROUP_POLL_MS);
    return () => {
      live = false;
      window.clearInterval(id);
    };
  }, [group.id]);

  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, typing]);

  async function send(): Promise<void> {
    const text = draft.trim();
    if (!text) return;
    setDraft("");
    try {
      await sendGroupMessage(group.id, text);
    } catch (e) {
      setError(errorText(e));
      setDraft(text);
    }
  }

  const typingNames = typing.map((id) => byId.get(id)?.name ?? "Someone");

  return (
    <div className="kleio-section">
      <div className="kleio-row-between">
        <button type="button" className="btn btn-ghost btn-sm" onClick={onBack}>
          ← All groups
        </button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onEdit}>
          Edit group
        </button>
      </div>
      <div className="kleio-row">
        <Face emoji={group.emoji} color={group.color} size={36} />
        <div>
          <h3 className="kleio-h3" style={{ margin: 0 }}>
            {group.name}
          </h3>
          <span className="kleio-list-sub">{members.map((m) => m.name).join(", ")}</span>
        </div>
      </div>
      <ErrorLine error={error} />
      <div className="kleio-chat-log kleio-group-log" ref={logRef} aria-live="polite">
        {messages.length === 0 && (
          <p className="kleio-empty">Say hello. Everyone replies, or @mention one of them.</p>
        )}
        {messages.map((m) => {
          const mine = m.author === "you";
          const b = byId.get(m.author);
          return (
            <div
              key={m.id}
              className={`kleio-gmsg${mine ? " mine" : ""}`}
              aria-label={`${mine ? "You" : m.authorName} said: ${m.text}`}
            >
              {!mine && <Face emoji={m.emoji} color={b?.color ?? "sky"} size={26} />}
              <div className="kleio-gbubble">
                {!mine && <span className="kleio-gname">{m.authorName}</span>}
                <span className="kleio-gtext">{m.text}</span>
              </div>
            </div>
          );
        })}
        {typingNames.length > 0 && (
          <p className="kleio-typing">{typingNames.join(", ")} is typing…</p>
        )}
      </div>
      <div className="kleio-chips" aria-label="Mention">
        {members.map((m) => (
          <button
            key={m.id}
            type="button"
            className="kleio-chip"
            onClick={() => setDraft((d) => `${d}${d && !d.endsWith(" ") ? " " : ""}@${m.name} `)}
          >
            @{m.name}
          </button>
        ))}
      </div>
      <form
        className="kleio-chat-bar"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <textarea
          className="modal-input kleio-chat-input"
          rows={2}
          value={draft}
          maxLength={4000}
          placeholder={`Message ${group.name}`}
          aria-label={`Message ${group.name}`}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
        />
        <button type="submit" className="btn btn-primary btn-sm" disabled={!draft.trim()}>
          Send
        </button>
      </form>
    </div>
  );
}

// ---------------------------------------------------------------- Apps

function AppsTab(): React.ReactElement {
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [connections, setConnections] = useState<Connection[]>([]);
  const [search, setSearch] = useState("");
  const [toolkits, setToolkits] = useState<Toolkit[] | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await listConnections();
      setConfigured(r.configured);
      setConnections(r.connections);
      setError(null);
    } catch (e) {
      setError(errorText(e));
    }
  }, []);
  useEffect(() => {
    void load();
    // Come back from the browser's sign-in: refresh when the window regains focus.
    const onFocus = (): void => void load();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [load]);

  useEffect(() => {
    if (!configured) return;
    let live = true;
    const t = window.setTimeout(() => {
      listToolkits({ search: search.trim() || undefined })
        .then((p) => live && setToolkits(p.toolkits))
        .catch((e) => live && setError(errorText(e)));
    }, 300);
    return () => {
      live = false;
      window.clearTimeout(t);
    };
  }, [configured, search]);

  async function connect(slug: string): Promise<void> {
    setPending(slug);
    setError(null);
    try {
      const r = await connectToolkit(slug);
      await openUrl(r.redirectUrl);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setPending(null);
    }
  }

  if (configured === false)
    return (
      <div className="kleio-section">
        <p className="kleio-empty">
          Apps aren't set up on the Kleio host yet. Put a Composio API key in the host's
          composio.key and restart it.
        </p>
      </div>
    );

  const connected = new Set(connections.filter((c) => c.status === "ACTIVE").map((c) => c.toolkit));

  return (
    <div className="kleio-section">
      <p className="modal-hint" style={{ color: theme.textMuted, margin: 0 }}>
        Connected apps work for Kleio and every Blob. Sign-in happens in your browser.
      </p>
      <ErrorLine error={error} />
      <h4 className="kleio-h4">Connected</h4>
      {configured === null ? (
        <p className="modal-hint">Loading…</p>
      ) : connections.length === 0 ? (
        <p className="kleio-empty">No apps connected yet.</p>
      ) : (
        <ul className="kleio-list">
          {connections.map((c) => (
            <li key={c.id} className="kleio-list-row">
              <AppLogo src={c.logo} name={c.name} />
              <span className="kleio-list-main">
                <span className="kleio-list-title">{c.name}</span>
                <span className="kleio-list-sub">{statusText(c.status)}</span>
              </span>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => void disconnect(c.id).then(load, (e) => setError(errorText(e)))}
              >
                Disconnect
              </button>
            </li>
          ))}
        </ul>
      )}
      <h4 className="kleio-h4">Add an app</h4>
      <input
        className="modal-input"
        type="search"
        placeholder="Search Gmail, Notion, Calendar…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        aria-label="Search apps"
      />
      {toolkits === null ? (
        <p className="modal-hint">Loading…</p>
      ) : (
        <ul className="kleio-list kleio-catalogue">
          {toolkits.map((t) => (
            <li key={t.slug} className="kleio-list-row">
              <AppLogo src={t.logo} name={t.name} />
              <span className="kleio-list-main">
                <span className="kleio-list-title">{t.name}</span>
                {t.description && (
                  <span className="kleio-list-sub kleio-clamp">{t.description}</span>
                )}
              </span>
              {connected.has(t.slug) ? (
                <span className="kleio-tag">Connected</span>
              ) : (
                <button
                  type="button"
                  className="btn btn-sm"
                  disabled={pending !== null}
                  onClick={() => void connect(t.slug)}
                >
                  {pending === t.slug ? "Opening…" : "Connect"}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function AppLogo({ src, name }: { src: string; name: string }): React.ReactElement {
  return src ? (
    <img className="kleio-app-logo" src={src} alt="" width={28} height={28} />
  ) : (
    <span className="kleio-app-logo kleio-app-logo-blank" aria-hidden="true">
      {name.slice(0, 1).toUpperCase()}
    </span>
  );
}

function statusText(status: string): string {
  switch (status.toUpperCase()) {
    case "ACTIVE":
      return "Connected";
    case "INITIATED":
    case "INITIALIZING":
      return "Waiting for you to finish signing in";
    case "EXPIRED":
      return "Expired — reconnect it";
    case "FAILED":
      return "Failed — try again";
    default:
      return status.toLowerCase();
  }
}

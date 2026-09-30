// A Blob's schedules and recent runs, and the form for one schedule (the Blobs
// page's "Schedules & activity" tab).

import { useCallback, useEffect, useState } from "react";
import { XIcon } from "@phosphor-icons/react";
import { describeSchedule, formatWhen, systemTimezone } from "./blobFormat";
import {
  addSchedule,
  deleteSchedule,
  errorText,
  listRuns,
  runScheduleNow,
  updateSchedule,
  type Blob,
  type Run,
  type Schedule,
  type ScheduleInput,
  type ScheduleKind,
} from "./kleioApi";

function ErrorLine({ error }: { error: string | null }): React.ReactElement | null {
  return error ? (
    <p className="kleio-error" role="alert">
      {error}
    </p>
  ) : null;
}

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

export function Schedules({
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
                className="btn btn-ghost btn-sm kleio-icon-btn"
                aria-label={`Delete ${s.label}`}
                title={`Delete ${s.label}`}
                onClick={() => void act(() => deleteSchedule(blob.id, s.id))}
              >
                <XIcon size={14} weight="bold" aria-hidden="true" />
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

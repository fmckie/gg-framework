// An agent's schedules and recent runs, as two cards in its sidebar, plus the
// dialog for adding or editing one schedule.

import { useCallback, useEffect, useState } from "react";
import {
  ArrowRightIcon,
  CheckCircleIcon,
  CircleNotchIcon,
  PencilSimpleIcon,
  PlayIcon,
  PlusIcon,
  TrashIcon,
  WarningCircleIcon,
} from "@phosphor-icons/react";
import { ConfirmModal } from "../ConfirmModal";
import { Dropdown } from "../Dropdown";
import { Modal } from "../Modal";
import { theme } from "../theme";
import { describeSchedule, formatWhen, plainSummary, systemTimezone } from "./blobFormat";
import { KleioPanel } from "./KleioChrome";
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

const RUNS_SHOWN = 12;
const RUNS_REFRESH_MS = 8_000;
const FLASH_MS = 2500;

function ErrorLine({ error }: { error: string | null }): React.ReactElement | null {
  return error ? (
    <p className="kleio-error" role="alert">
      {error}
    </p>
  ) : null;
}

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
// Monday first, like the phone.
const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0];
const INTERVALS: { minutes: number; label: string }[] = [
  { minutes: 15, label: "15 minutes" },
  { minutes: 30, label: "30 minutes" },
  { minutes: 60, label: "hour" },
  { minutes: 120, label: "2 hours" },
  { minutes: 240, label: "4 hours" },
  { minutes: 360, label: "6 hours" },
  { minutes: 720, label: "12 hours" },
];
const KINDS: readonly (readonly [ScheduleKind, string])[] = [
  ["daily", "Daily"],
  ["weekly", "Weekly"],
  ["interval", "Repeat"],
  ["once", "Once"],
];

function RunIcon({ run }: { run: Run }): React.ReactElement {
  if (!run.endedAt)
    return <CircleNotchIcon className="kleio-spin" size={16} weight="bold" aria-label="Running" />;
  if (run.outcome === "ok")
    return <CheckCircleIcon size={16} weight="fill" color={theme.success} aria-label="Done" />;
  if (run.outcome === "error")
    return <WarningCircleIcon size={16} weight="fill" color={theme.error} aria-label="Failed" />;
  return <ArrowRightIcon size={16} weight="bold" aria-label="Skipped" />;
}

export function Schedules({
  blob,
  onChanged,
}: {
  blob: Blob;
  onChanged: () => Promise<void>;
}): React.ReactElement {
  const [runs, setRuns] = useState<Run[] | null>(null);
  const [editing, setEditing] = useState<Schedule | "new" | null>(null);
  const [deleting, setDeleting] = useState<Schedule | null>(null);
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
    const id = window.setInterval(() => void loadRuns(), RUNS_REFRESH_MS);
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
        window.setTimeout(() => setFlash(null), FLASH_MS);
      }
    } catch (e) {
      setError(errorText(e));
    }
  }

  return (
    <>
      <KleioPanel
        title="Schedules"
        count={blob.schedules.length}
        action={
          <button type="button" className="kleio-text-btn" onClick={() => setEditing("new")}>
            <PlusIcon size={12} weight="bold" aria-hidden="true" />
            Add
          </button>
        }
      >
        <ErrorLine error={error} />
        {flash && <p className="kleio-note">{flash}</p>}
        {blob.schedules.length === 0 ? (
          <p className="kleio-empty">
            No schedules. Mention timing in the job (“every weekday at 7:30”) or add one.
          </p>
        ) : (
          <ul className="kleio-sched-list">
            {blob.schedules.map((s) => (
              <li key={s.id} className={`kleio-sched${s.enabled ? "" : " is-off"}`}>
                <div className="kleio-sched-top">
                  <span className="kleio-sched-name">{s.label}</span>
                  {s.source === "auto" && (
                    <span className="kleio-tag" title="Read from the job">
                      Auto
                    </span>
                  )}
                  <label className="cl-switch kleio-switch">
                    <input
                      type="checkbox"
                      checked={s.enabled}
                      onChange={(e) =>
                        void act(() => updateSchedule(blob.id, s.id, { enabled: e.target.checked }))
                      }
                      aria-label={`${s.label} on`}
                    />
                    <span />
                  </label>
                </div>
                <span className="kleio-sched-when">
                  {describeSchedule(s)}
                  {s.enabled ? (s.nextRunAt ? ` · next ${formatWhen(s.nextRunAt)}` : "") : " · off"}
                </span>
                <div className="kleio-sched-actions">
                  <button
                    type="button"
                    className="kleio-text-btn"
                    onClick={() =>
                      void act(
                        () => runScheduleNow(blob.id, s.id),
                        "Started — the result will show in Recent activity.",
                      )
                    }
                  >
                    <PlayIcon size={12} weight="fill" aria-hidden="true" />
                    Run now
                  </button>
                  <button type="button" className="kleio-text-btn" onClick={() => setEditing(s)}>
                    <PencilSimpleIcon size={12} weight="bold" aria-hidden="true" />
                    Edit
                  </button>
                  <button
                    type="button"
                    className="kleio-text-btn is-danger"
                    aria-label={`Delete ${s.label}`}
                    title={`Delete ${s.label}`}
                    onClick={() => setDeleting(s)}
                  >
                    <TrashIcon size={12} weight="bold" aria-hidden="true" />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </KleioPanel>

      <KleioPanel title="Recent activity">
        {runs === null ? (
          <p className="kleio-empty">Loading…</p>
        ) : runs.length === 0 ? (
          <p className="kleio-empty">Nothing has run yet.</p>
        ) : (
          <ul className="kleio-runs">
            {runs.slice(0, RUNS_SHOWN).map((r) => (
              <li key={r.id} className={`kleio-run is-${r.endedAt ? r.outcome : "running"}`}>
                <span className="kleio-run-icon">
                  <RunIcon run={r} />
                </span>
                <span className="kleio-run-text">
                  <span className="kleio-run-top">
                    <span className="kleio-run-name">{r.label}</span>
                    <span className="kleio-run-when">{formatWhen(r.startedAt)}</span>
                  </span>
                  {(r.summary || r.error) && (
                    <span className="kleio-run-sub">
                      {r.summary ? plainSummary(r.summary) : r.error}
                    </span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
      </KleioPanel>

      {editing && (
        <Modal
          title={editing === "new" ? "New schedule" : "Edit schedule"}
          onClose={() => setEditing(null)}
        >
          <ScheduleForm
            {...(editing === "new" ? {} : { schedule: editing })}
            onCancel={() => setEditing(null)}
            onSave={async (input) => {
              await (editing === "new"
                ? addSchedule(blob.id, input)
                : updateSchedule(blob.id, editing.id, input));
              setEditing(null);
              await onChanged();
            }}
          />
        </Modal>
      )}
      {deleting && (
        <ConfirmModal
          title={`Delete “${deleting.label}”?`}
          message="The agent stops running on this schedule. You can add it again later."
          confirmLabel="Delete"
          onConfirm={() => {
            const s = deleting;
            setDeleting(null);
            void act(() => deleteSchedule(blob.id, s.id));
          }}
          onClose={() => setDeleting(null)}
        />
      )}
    </>
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
  const inputStyle = { color: theme.text, background: theme.inputBackground };

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
    <form className="kleio-sched-form" onSubmit={(e) => void save(e)}>
      <label className="modal-label" htmlFor="kleio-s-label">
        Name
      </label>
      <input
        id="kleio-s-label"
        className="modal-input"
        style={inputStyle}
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
        style={inputStyle}
        rows={3}
        value={prompt}
        maxLength={4000}
        onChange={(e) => setPrompt(e.target.value)}
        placeholder="Check today's London weather and tell me what to wear."
      />
      <span className="modal-label" id="kleio-s-when">
        When
      </span>
      <div className="kleio-seg" role="radiogroup" aria-labelledby="kleio-s-when">
        {KINDS.map(([k, l]) => (
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
      <div className="kleio-when">
        {kind === "interval" && (
          <Dropdown
            label="Every"
            options={INTERVALS.map((i) => ({
              value: String(i.minutes),
              label: `Every ${i.label}`,
            }))}
            value={String(every)}
            onChange={(v) => setEvery(Number(v))}
          />
        )}
        {kind === "weekly" && (
          <div className="kleio-days" role="group" aria-label="Days">
            {DAY_ORDER.map((i) => (
              <button
                key={i}
                type="button"
                className="kleio-day"
                aria-pressed={days.includes(i)}
                onClick={() =>
                  setDays((cur) => (cur.includes(i) ? cur.filter((x) => x !== i) : [...cur, i]))
                }
              >
                {DAY_NAMES[i]}
              </button>
            ))}
          </div>
        )}
        {(kind === "daily" || kind === "weekly") && (
          <input
            type="time"
            className="modal-input kleio-time"
            style={inputStyle}
            value={time}
            onChange={(e) => setTime(e.target.value)}
            aria-label="Time"
          />
        )}
        {kind === "once" && (
          <input
            type="datetime-local"
            className="modal-input"
            style={inputStyle}
            value={at}
            onChange={(e) => setAt(e.target.value)}
            aria-label="Date and time"
          />
        )}
      </div>
      <label className="kleio-setting">
        <span className="kleio-setting-text">
          <span className="kleio-setting-name">Notify me</span>
          <span className="kleio-setting-desc">Send a notification with the result.</span>
        </span>
        <span className="cl-switch kleio-switch">
          <input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} />
          <span />
        </span>
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

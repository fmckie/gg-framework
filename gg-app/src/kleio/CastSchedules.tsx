// A specialist's schedules inside its form, on the desktop: this week as seven
// days with a mark where each schedule falls, and the selected one open for
// editing underneath. Every change goes to the host as it does from the chat's
// sidebar (BlobSchedules.tsx): the switch, Run now and Delete at once, edits
// to the words and the timing when its own Save is pressed.

import { useId, useState } from "react";
import { PlayIcon, PlusIcon, TrashIcon } from "@phosphor-icons/react";
import { ConfirmModal } from "../ConfirmModal";
import { Dropdown } from "../Dropdown";
import { formatWhen, ranLate, systemTimezone } from "./blobFormat";
import {
  DAY_NAMES,
  DAY_ORDER,
  FLASH_MS,
  INTERVALS,
  KINDS,
  useScheduleDraft,
} from "./BlobSchedules";
import { castWeek, soonest, type WeekMark } from "./castLayout";
import { shortHost } from "./host-name";
import {
  addSchedule,
  deleteSchedule,
  errorText,
  runScheduleNow,
  updateSchedule,
  type Blob,
  type Schedule,
} from "./kleioApi";
import { useKleioRemote } from "./useKleioRemote";

const DAY_FULL = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const NEW = "new";

/** What the host holds for a schedule's editable parts: a change remounts its editor. */
const held = (s: Schedule): string =>
  JSON.stringify([s.label, s.prompt, s.kind, s.everyMinutes, s.time, s.days, s.at, s.notify]);

function Mark({
  mark,
  day,
  selected,
  onPick,
}: {
  mark: WeekMark;
  /** Its weekday; absent under the week. */
  day?: number;
  selected: boolean;
  onPick: () => void;
}): React.ReactElement {
  const s = mark.schedule;
  const auto = s.source === "auto";
  const when = day === undefined ? mark.text : `${DAY_FULL[day]} ${mark.text}`;
  return (
    <button
      type="button"
      className={`cast-mark${auto ? " is-auto" : ""}${selected ? " is-sel" : ""}${s.enabled ? "" : " is-off"}`}
      aria-pressed={selected}
      aria-label={`${s.label}, ${when}${auto ? ", read from the job" : ""}${s.enabled ? "" : ", off"}`}
      title={auto ? "Read from the job" : s.label}
      onClick={onPick}
    >
      {mark.text}
      <small>{s.label}</small>
    </button>
  );
}

export function CastSchedules({
  blob,
  onChanged,
  now,
}: {
  /** Absent on a new specialist: nothing to schedule until it is saved. */
  blob?: Blob;
  onChanged: () => Promise<void>;
  /** Hold the clock still (tests). */
  now?: Date;
}): React.ReactElement {
  const [picked, setPicked] = useState<string | null>(null);
  // Bumped by Cancel: the editor starts again from what the host holds.
  const [fresh, setFresh] = useState(0);
  const [deleting, setDeleting] = useState<Schedule | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const host = useKleioRemote().status?.active?.host;
  const headId = useId();
  const clock = now ?? new Date();
  const schedules = blob?.schedules ?? [];
  const week = castWeek(schedules, clock);
  const adding = picked === NEW;
  const selected = adding ? null : (schedules.find((s) => s.id === picked) ?? soonest(schedules));

  async function act(work: () => Promise<unknown>, done?: string): Promise<void> {
    setError(null);
    try {
      await work();
      await onChanged();
      if (done) {
        setFlash(done);
        window.setTimeout(() => setFlash(null), FLASH_MS);
      }
    } catch (e) {
      setError(errorText(e));
    }
  }

  const mark = (m: WeekMark, day?: number): React.ReactElement => (
    <Mark
      key={`${m.schedule.id}-${day ?? "loose"}`}
      mark={m}
      {...(day === undefined ? {} : { day })}
      selected={m.schedule.id === selected?.id}
      onPick={() => setPicked(m.schedule.id)}
    />
  );

  return (
    <section className="cast-card cast-sched-card" aria-labelledby={headId}>
      <div className="cast-card-head">
        <h2 className="cast-label" id={headId}>
          Schedules{blob && <span className="cast-count">{schedules.length}</span>}
        </h2>
        {blob && <span className="cast-hint">{systemTimezone()}</span>}
        {blob && (
          <button type="button" className="kleio-text-btn" onClick={() => setPicked(NEW)}>
            <PlusIcon size={12} weight="bold" aria-hidden="true" />
            Add
          </button>
        )}
      </div>
      {error && (
        <p className="kleio-error" role="alert">
          {error}
        </p>
      )}
      {flash && <p className="kleio-note">{flash}</p>}
      <ol className="cast-week" aria-label="This week">
        {week.days.map((d) => (
          <li key={d.day}>
            <span className="cast-wd">{DAY_NAMES[d.day]}</span>
            {d.marks.map((m) => mark(m, d.day))}
          </li>
        ))}
      </ol>
      {week.loose.length > 0 && (
        <div className="cast-loose" role="group" aria-label="Not on a day this week">
          {week.loose.map((m) => mark(m))}
        </div>
      )}
      {schedules.some((s) => s.source === "auto") && (
        <p className="cast-legend">
          <span className="cast-key" aria-hidden="true" />
          Dashed: read from the job, so it follows the job when you change it.
        </p>
      )}
      {!blob && <p className="kleio-empty">Times are in {systemTimezone()}.</p>}
      {blob && schedules.length === 0 && !adding && (
        <p className="kleio-empty">
          No schedules. Mention timing in the job (“every weekday at 7:30”) or add one.
        </p>
      )}
      {blob && (selected || adding) && (
        <Editor
          key={selected ? `${selected.id}:${held(selected)}:${fresh}` : NEW}
          blobId={blob.id}
          {...(selected ? { schedule: selected } : {})}
          hostLabel={host ? shortHost(host) : "your host"}
          now={clock}
          act={act}
          onSaved={async (id) => {
            setPicked(id);
            await onChanged();
          }}
          onCancel={() => (selected ? setFresh((n) => n + 1) : setPicked(null))}
          onDelete={() => setDeleting(selected)}
        />
      )}
      {blob && deleting && (
        <ConfirmModal
          title={`Delete “${deleting.label}”?`}
          message="The specialist stops running on this schedule. You can add it again later."
          confirmLabel="Delete"
          onConfirm={() => {
            const s = deleting;
            setDeleting(null);
            void act(() => deleteSchedule(blob.id, s.id));
          }}
          onClose={() => setDeleting(null)}
        />
      )}
    </section>
  );
}

function Editor({
  blobId,
  schedule,
  hostLabel,
  now,
  act,
  onSaved,
  onCancel,
  onDelete,
}: {
  blobId: string;
  /** Absent = a new one. */
  schedule?: Schedule;
  hostLabel: string;
  now: Date;
  act: (work: () => Promise<unknown>, done?: string) => Promise<void>;
  onSaved: (id: string) => Promise<void>;
  onCancel: () => void;
  onDelete: () => void;
}): React.ReactElement {
  const draft = useScheduleDraft(schedule);
  const { kind } = draft;
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const late = schedule ? ranLate(schedule.lastRun, schedule.timezone, hostLabel) : null;
  const what = schedule ? "schedule changes" : "new schedule";

  async function save(): Promise<void> {
    setSaving(true);
    setError(null);
    try {
      const saved = await (schedule
        ? updateSchedule(blobId, schedule.id, draft.input())
        : addSchedule(blobId, draft.input()));
      await onSaved(saved.id);
    } catch (e) {
      setError(errorText(e));
    }
    setSaving(false);
  }

  return (
    <div className="cast-se" role="group" aria-label={schedule ? schedule.label : "New schedule"}>
      <div className="cast-se-top">
        <input
          className="cast-se-name"
          value={draft.label}
          maxLength={60}
          onChange={(e) => draft.setLabel(e.target.value)}
          placeholder="Morning check-in"
          aria-label="Schedule name"
        />
        {schedule?.source === "auto" && (
          <span className="kleio-tag" title="Read from the job">
            Auto
          </span>
        )}
        <span className="cast-se-next">
          {!schedule
            ? "New schedule"
            : !schedule.enabled
              ? "off"
              : schedule.nextRunAt
                ? `next ${formatWhen(schedule.nextRunAt, now)}`
                : ""}
        </span>
        {schedule && (
          <label className="cast-switch">
            <input
              type="checkbox"
              checked={schedule.enabled}
              onChange={(e) =>
                void act(() => updateSchedule(blobId, schedule.id, { enabled: e.target.checked }))
              }
              aria-label={`${schedule.label} on`}
            />
            <span />
          </label>
        )}
      </div>
      {late && <p className="cast-se-late">{late}</p>}
      <textarea
        className="cast-se-prompt"
        rows={1}
        value={draft.prompt}
        maxLength={4000}
        onChange={(e) => draft.setPrompt(e.target.value)}
        placeholder="Check today's London weather and tell me what to wear."
        aria-label="What to do"
      />
      <div className="cast-se-when">
        <div className="cast-seg" role="radiogroup" aria-label="When">
          {KINDS.map(([k, l]) => (
            <button
              key={k}
              type="button"
              role="radio"
              aria-checked={kind === k}
              onClick={() => draft.setKind(k)}
            >
              {l}
            </button>
          ))}
        </div>
        {kind === "weekly" && (
          <div className="cast-days" role="group" aria-label="Days">
            {DAY_ORDER.map((i) => (
              <button
                key={i}
                type="button"
                aria-pressed={draft.days.includes(i)}
                aria-label={DAY_FULL[i]}
                onClick={() => draft.toggleDay(i)}
              >
                {DAY_FULL[i]?.charAt(0)}
              </button>
            ))}
          </div>
        )}
        {(kind === "daily" || kind === "weekly") && (
          <input
            type="time"
            className="cast-field"
            value={draft.time}
            onChange={(e) => draft.setTime(e.target.value)}
            aria-label="Time"
          />
        )}
        {kind === "interval" && (
          <Dropdown
            label="Every"
            options={INTERVALS.map((i) => ({
              value: String(i.minutes),
              label: `Every ${i.label}`,
            }))}
            value={String(draft.every)}
            onChange={(v) => draft.setEvery(Number(v))}
          />
        )}
        {kind === "once" && (
          <input
            type="datetime-local"
            className="cast-field"
            value={draft.at}
            onChange={(e) => draft.setAt(e.target.value)}
            aria-label="Date and time"
          />
        )}
      </div>
      <div className="cast-se-foot">
        <label className="cast-check">
          <span className="cast-switch">
            <input
              type="checkbox"
              checked={draft.notify}
              onChange={(e) => draft.setNotify(e.target.checked)}
            />
            <span />
          </span>
          Notify me with the result
        </label>
        <span className="cast-grow" />
        {/* A changed schedule is saved or put back before it can be run. */}
        {draft.dirty || !schedule ? (
          <>
            <button
              type="button"
              className="kleio-text-btn"
              aria-label={`Cancel ${what}`}
              onClick={onCancel}
              disabled={saving}
            >
              Cancel
            </button>
            <button
              type="button"
              className="cast-se-save"
              onClick={() => void save()}
              disabled={saving || !draft.valid}
            >
              {saving ? "Saving…" : "Save schedule"}
            </button>
          </>
        ) : (
          <button
            type="button"
            className="kleio-text-btn"
            onClick={() =>
              void act(
                () => runScheduleNow(blobId, schedule.id),
                "Started — the result will show in Recent activity.",
              )
            }
          >
            <PlayIcon size={12} weight="fill" aria-hidden="true" />
            Run now
          </button>
        )}
        {schedule && (
          <button
            type="button"
            className="kleio-text-btn is-danger"
            aria-label={`Delete ${schedule.label}`}
            title={`Delete ${schedule.label}`}
            onClick={onDelete}
          >
            <TrashIcon size={12} weight="bold" aria-hidden="true" />
          </button>
        )}
      </div>
      {error && (
        <p className="kleio-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

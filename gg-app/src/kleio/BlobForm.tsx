// Create / edit a specialist as a full page: Identity (name and drawn look)
// and Job cards on the left; Preview, Brain and Scheduling cards in the
// sidebar. New specialists schedule in this Mac's timezone; unless you
// switch it off, the host reads timing out of the job ("every morning",
// "weekdays at 6") and the result is shown after save.

import { useEffect, useId, useState } from "react";
import { CloudIcon, LockSimpleIcon } from "@phosphor-icons/react";
import { Dropdown, type DropdownOption } from "../Dropdown";
import { MetalButton } from "../MetalButton";
import { useWindowFocused } from "../useWindowFocused";
import { AgentRowContent, agentRowState } from "./AgentRow";
import { BlobAvatar } from "./BlobAvatar";
import { freshLook, lookOf, type BlobLook } from "./blobLook";
import { systemTimezone } from "./blobFormat";
import { KleioHead, KleioPanel } from "./KleioChrome";
import { LookPicker } from "./LookPicker";
import {
  BLOB_COLORS,
  createBlob,
  listModels,
  updateBlob,
  errorText,
  type Blob,
  type BlobColor,
  type BlobSaved,
  type KleioModel,
  type ModelList,
} from "./kleioApi";

const DEFAULT = "";
const NAME_MAX = 40;
const JOB_MAX = 8000;
/** Only count characters once the job is long enough for the limit to matter. */
const JOB_COUNT_FROM = 6000;
/** Hosts from before agent looks accept only the original six colours. */
const ORIGINAL_COLORS: readonly BlobColor[] = BLOB_COLORS.slice(0, 6);

/** Starting points for a first job; clicking one fills the Job box. */
const JOB_EXAMPLES: readonly { label: string; job: string }[] = [
  {
    label: "Morning news",
    job: "Every weekday at 7:30, send me the three most important news stories in two lines each.",
  },
  {
    label: "Weekly meal plan",
    job: "Every Sunday at 5pm, plan three dinners for the week from what's in season, with a shopping list.",
  },
  {
    label: "Research on request",
    job: "When I ask, research a topic properly and reply with a short summary and the sources you used.",
  },
];

/** Where a model runs, in words. Tinfoil is a confidential-compute cloud,
 *  not the user's own hardware; Ollama runs on the Mac mini itself. */
export function whereItRuns(m: KleioModel): string {
  if (!m.private) return "Cloud — runs on the provider's servers";
  if (/tinfoil/i.test(m.label)) return "Private — runs in Tinfoil's sealed cloud";
  return "Private — runs on your Mac mini";
}

export function modelOptions(list: ModelList | null): DropdownOption[] {
  const def = list?.models.find((m) => m.id === list.defaultBlobModel);
  return [
    {
      value: DEFAULT,
      label: `Default${def ? ` — ${def.label}` : ""}`,
      description: "The host's standard brain for specialists",
    },
    ...(list?.models ?? []).map((m) => ({
      value: m.id,
      label: m.label,
      description: whereItRuns(m),
    })),
  ];
}

export function BlobForm({
  blob,
  others = [],
  onSaved,
  onCancel,
}: {
  /** Absent = create. */
  blob?: Blob;
  /** The other agents: a new one gets a look unlike theirs. */
  others?: readonly Blob[];
  onSaved: (saved: BlobSaved) => void;
  onCancel: () => void;
}): React.ReactElement {
  // A host that knows looks sends `shape` on every agent; with none to go
  // by, assume it does (a mismatch shows the host's own error on save).
  const looksKnown = others.length === 0 || others.some((b) => b.shape !== undefined);
  const colors = looksKnown ? BLOB_COLORS : ORIGINAL_COLORS;
  const [name, setName] = useState(blob?.name ?? "");
  const [look, setLook] = useState<BlobLook>(() =>
    blob ? lookOf(blob) : freshLook(others.map(lookOf), colors),
  );
  const [job, setJob] = useState(blob?.job ?? "");
  const [model, setModel] = useState(blob?.model ?? DEFAULT);
  const [readTiming, setReadTiming] = useState(true);
  const [models, setModels] = useState<ModelList | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const windowFocused = useWindowFocused();
  const formId = useId();
  const ids = {
    form: `${formId}-form`,
    name: `${formId}-name`,
    job: `${formId}-job`,
  };
  const timezone = systemTimezone();
  const jobChanged = !blob || job.trim() !== blob.job;
  const reading = jobChanged && readTiming;

  useEffect(() => {
    let live = true;
    listModels()
      .then((m) => live && setModels(m))
      .catch(() => live && setModels({ models: [], defaultBlobModel: "" }));
    return () => {
      live = false;
    };
  }, []);

  async function save(): Promise<void> {
    if (!name.trim() || !job.trim() || saving) return;
    setSaving(true);
    setError(null);
    const common = {
      name: name.trim(),
      color: look.color,
      job: job.trim(),
      // Older hosts would reject these; they also send no `shape` to keep.
      ...(looksKnown ? { shape: look.shape, face: look.face } : {}),
    };
    try {
      const saved = blob
        ? await updateBlob(blob.id, {
            ...common,
            model: model || null,
            ...(jobChanged ? { timezone, autoSchedule: readTiming } : {}),
          })
        : await createBlob({
            ...common,
            ...(model ? { model } : {}),
            timezone,
            autoSchedule: readTiming,
          });
      onSaved(saved);
    } catch (e) {
      setError(errorText(e));
      setSaving(false);
    }
  }

  const chosen = models?.models.find((m) => m.id === (model || models.defaultBlobModel));
  const canSave = !saving && Boolean(name.trim()) && Boolean(job.trim());
  const title = blob ? `Edit ${blob.name}` : "New specialist";

  const main = (
    <div className="kleio-form-main">
      <KleioPanel
        title="Identity"
        description="Its name, and how it looks in your lists and chats."
      >
        <div className="kleio-field">
          <label className="kleio-label" htmlFor={ids.name}>
            Name
          </label>
          <input
            id={ids.name}
            className="modal-input"
            value={name}
            maxLength={NAME_MAX}
            required
            autoFocus
            placeholder="Chef"
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <LookPicker look={look} colors={colors} onChange={setLook} />
      </KleioPanel>

      <KleioPanel
        title="Job"
        description="One job, in plain words. Say when it should happen and what to send back."
      >
        <label className="sr-only" htmlFor={ids.job}>
          Job
        </label>
        <textarea
          id={ids.job}
          className="modal-input kleio-job"
          value={job}
          maxLength={JOB_MAX}
          required
          rows={7}
          placeholder="Plan three dinners every Sunday evening from what's in season."
          onChange={(e) => setJob(e.target.value)}
        />
        {job.length >= JOB_COUNT_FROM && (
          <p className="kleio-count-line">
            {job.length.toLocaleString()} / {JOB_MAX.toLocaleString()}
          </p>
        )}
        {!blob && !job.trim() && (
          <div className="kleio-examples" role="group" aria-label="Example jobs">
            <span className="kleio-examples-label">Try</span>
            {JOB_EXAMPLES.map((x) => (
              <button
                key={x.label}
                type="button"
                className="kleio-example"
                onClick={() => setJob(x.job)}
              >
                {x.label}
              </button>
            ))}
          </div>
        )}
      </KleioPanel>
    </div>
  );

  const side = (
    <>
      <KleioPanel title="Preview">
        <div className="picker-item kleio-row kleio-preview" aria-hidden="true">
          <AgentRowContent
            name={name.trim() || "Your specialist"}
            avatar={<BlobAvatar look={look} size={36} />}
            sub={job.trim() || "Its job will show here."}
            state={blob ? agentRowState(blob) : { text: "On call", tone: "plain" }}
          />
        </div>
      </KleioPanel>

      <KleioPanel title="Brain" description="The model that does the thinking for this specialist.">
        <Dropdown
          label="Brain"
          options={modelOptions(models)}
          value={model}
          onChange={setModel}
          disabled={models === null}
          placeholder="Loading models…"
        />
        {chosen && (
          <p className="kleio-brain-note">
            {chosen.private ? (
              <LockSimpleIcon size={13} weight="bold" aria-hidden="true" />
            ) : (
              <CloudIcon size={13} weight="bold" aria-hidden="true" />
            )}
            {whereItRuns(chosen)}.
          </p>
        )}
      </KleioPanel>

      <KleioPanel title="Scheduling">
        <div className="kleio-setting">
          <span className="kleio-setting-text">
            <span className="kleio-setting-name">Read timing from the job</span>
            <span className="kleio-setting-desc">
              {blob
                ? "When the job changes, “every weekday at 7:30” replaces its earlier automatic schedules. Ones you added yourself stay."
                : "“Every weekday at 7:30” becomes a schedule you can change later."}
            </span>
          </span>
          <label className="cl-switch kleio-switch">
            <input
              type="checkbox"
              checked={readTiming}
              onChange={(e) => setReadTiming(e.target.checked)}
              aria-label="Read timing from the job"
            />
            <span />
          </label>
        </div>
        <p className="kleio-setting-foot">Times are in {timezone}.</p>
      </KleioPanel>
    </>
  );

  // The header sits outside the <form>: its Back, radio and window buttons are
  // plain <button>s that would otherwise submit it. Create reaches the form
  // through its `form` attribute instead.
  return (
    <div className="kleio-form-page">
      <KleioHead
        onBack={onCancel}
        title={title}
        actions={
          <>
            <button type="button" className="btn btn-ghost btn-sm" onClick={onCancel}>
              Cancel
            </button>
            <MetalButton
              type="submit"
              form={ids.form}
              className="btn btn-primary btn-sm"
              windowFocused={windowFocused}
              disabled={!canSave}
            >
              {saving
                ? reading
                  ? "Saving… reading the job"
                  : "Saving…"
                : blob
                  ? "Save"
                  : "Create"}
            </MetalButton>
          </>
        }
      />
      {error && (
        <p className="kleio-error kleio-page-error" role="alert">
          {error}
        </p>
      )}
      <form
        id={ids.form}
        className="kleio-form-scroll"
        aria-label={title}
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <div className="kleio-form-grid">
          {main}
          <aside className="kleio-form-side" aria-label="Specialist settings">
            {side}
          </aside>
        </div>
      </form>
    </div>
  );
}

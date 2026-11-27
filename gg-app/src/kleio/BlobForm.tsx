// What a specialist's form holds and does, drawn by the Cast (CastForm.tsx):
// its fields, the example jobs, saving, and the form's header. New specialists
// schedule in this device's timezone; unless you switch it off, the host reads
// timing out of the job ("every morning", "weekdays at 6") and the result is
// shown after save.

import { useEffect, useState } from "react";
import type { DropdownOption } from "../Dropdown";
import { MetalButton } from "../MetalButton";
import { useWindowFocused } from "../useWindowFocused";
import { freshLook, lookOf, type BlobLook } from "./blobLook";
import { systemTimezone } from "./blobFormat";
import { KleioHead } from "./KleioChrome";
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
export const NAME_MAX = 40;
export const JOB_MAX = 8000;
/** Only count characters once the job is long enough for the limit to matter. */
export const JOB_COUNT_FROM = 6000;
/** Hosts from before agent looks accept only the original six colours. */
const ORIGINAL_COLORS: readonly BlobColor[] = BLOB_COLORS.slice(0, 6);

/** Starting points for a first job; clicking one fills the Job box. */
export const JOB_EXAMPLES: readonly { label: string; job: string }[] = [
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
  return "Private — runs on your host";
}

/** The same three, short enough for one line of a profile. */
export function whereItRunsShort(m: KleioModel): string {
  if (!m.private) return "cloud";
  if (/tinfoil/i.test(m.label)) return "private, in Tinfoil’s sealed cloud";
  return "private, runs on your host";
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

export interface BlobFormProps {
  /** Absent = create. */
  blob?: Blob;
  /** The other agents: a new one gets a look unlike theirs. */
  others?: readonly Blob[];
  onSaved: (saved: BlobSaved) => void;
  onCancel: () => void;
}

/** Everything the form holds and how it saves; today's form and the Cast's draw it. */
export function useBlobForm({
  blob,
  others = [],
  onSaved,
  startJob = "",
}: Omit<BlobFormProps, "onCancel"> & {
  /** A new specialist's job to start from (an example picked on the first run). */
  startJob?: string;
}) {
  // A host that knows looks sends `shape` on every agent; with none to go
  // by, assume it does (a mismatch shows the host's own error on save).
  const looksKnown = others.length === 0 || others.some((b) => b.shape !== undefined);
  const colors = looksKnown ? BLOB_COLORS : ORIGINAL_COLORS;
  const [name, setName] = useState(blob?.name ?? "");
  const [look, setLook] = useState<BlobLook>(() =>
    blob ? lookOf(blob) : freshLook(others.map(lookOf), colors),
  );
  const [job, setJob] = useState(blob?.job ?? startJob);
  const [model, setModel] = useState(blob?.model ?? DEFAULT);
  const [readTiming, setReadTiming] = useState(true);
  const [models, setModels] = useState<ModelList | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
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

  const saveLabel = saving
    ? reading
      ? "Saving… reading the job"
      : "Saving…"
    : blob
      ? "Save"
      : "Create";
  return {
    ...{ name, setName, look, setLook, job, setJob, model, setModel },
    ...{ readTiming, setReadTiming, models, colors, timezone, chosen },
    ...{ saving, error, canSave, title, saveLabel, save },
  };
}

/** The form's header: Back, its title, Cancel and Save, with a failed save under it.
 *  It sits outside the <form>: its Back, radio and window buttons are plain
 *  <button>s that would otherwise submit it. Save reaches the form through its
 *  `form` attribute instead. */
export function BlobFormHead({
  form,
  formId,
  onCancel,
}: {
  form: Pick<ReturnType<typeof useBlobForm>, "title" | "saveLabel" | "canSave" | "error">;
  formId: string;
  onCancel: () => void;
}): React.ReactElement {
  const windowFocused = useWindowFocused();
  return (
    <>
      <KleioHead
        onBack={onCancel}
        title={form.title}
        actions={
          <>
            <button type="button" className="btn btn-ghost btn-sm" onClick={onCancel}>
              Cancel
            </button>
            <MetalButton
              type="submit"
              form={formId}
              className="btn btn-primary btn-sm"
              windowFocused={windowFocused}
              disabled={!form.canSave}
            >
              {form.saveLabel}
            </MetalButton>
          </>
        }
      />
      {form.error && (
        <p className="kleio-error kleio-page-error" role="alert">
          {form.error}
        </p>
      )}
    </>
  );
}

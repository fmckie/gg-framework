// Create / edit a Blob: name, emoji, colour, job and brain. New Blobs schedule
// in this Mac's timezone; the host reads timing out of the job ("every
// morning", "weekdays at 6") and the result is shown after save.

import { useEffect, useState } from "react";
import { Dropdown, type DropdownOption } from "../Dropdown";
import { theme } from "../theme";
import { BLOB_COLOR_HEX, systemTimezone } from "./blobFormat";
import {
  BLOB_COLORS,
  createBlob,
  listModels,
  updateBlob,
  errorText,
  type Blob,
  type BlobColor,
  type BlobSaved,
  type ModelList,
} from "./kleioApi";

const EMOJI_PICKS = ["🫧", "🍳", "📬", "🏃", "📚", "💸", "🌱", "🧠", "🗓️", "✈️"];
const DEFAULT = "";

function firstGrapheme(s: string): string {
  const t = s.trim();
  if (!t) return "";
  // Intl.Segmenter is in WebKit but not in this project's TS lib, so it's typed here.
  type Segmenter = new (
    locale: undefined,
    o: { granularity: "grapheme" },
  ) => { segment(s: string): Iterable<{ segment: string }> };
  const Seg = (Intl as unknown as { Segmenter?: Segmenter }).Segmenter;
  if (!Seg) return Array.from(t)[0] ?? "";
  const first = new Seg(undefined, { granularity: "grapheme" })
    .segment(t)
    [Symbol.iterator]()
    .next();
  return first.done ? "" : first.value.segment;
}

export function modelOptions(list: ModelList | null): DropdownOption[] {
  const def = list?.models.find((m) => m.id === list.defaultBlobModel);
  return [
    {
      value: DEFAULT,
      label: `Default${def ? ` — ${def.label}` : ""}`,
      description: "The host's standard brain for agents",
    },
    ...(list?.models ?? []).map((m) => ({
      value: m.id,
      label: m.label,
      description: m.private ? "Private — runs on your own hardware" : "Cloud",
    })),
  ];
}

export function BlobForm({
  blob,
  onSaved,
  onCancel,
  heading = true,
}: {
  /** Absent = create. */
  blob?: Blob;
  onSaved: (saved: BlobSaved) => void;
  onCancel: () => void;
  /** Its own "New Blob" / "Edit …" title; off when a card already names it. */
  heading?: boolean;
}): React.ReactElement {
  const [name, setName] = useState(blob?.name ?? "");
  const [emoji, setEmoji] = useState(blob?.emoji ?? "🫧");
  const [color, setColor] = useState<BlobColor>(blob?.color ?? "sky");
  const [job, setJob] = useState(blob?.job ?? "");
  const [model, setModel] = useState(blob?.model ?? DEFAULT);
  const [models, setModels] = useState<ModelList | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timezone = systemTimezone();
  const jobChanged = !blob || job.trim() !== blob.job;

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
    const common = { name: name.trim(), emoji: emoji || "🫧", color, job: job.trim() };
    try {
      const saved = blob
        ? await updateBlob(blob.id, {
            ...common,
            model: model || null,
            ...(jobChanged ? { timezone } : {}),
          })
        : await createBlob({ ...common, ...(model ? { model } : {}), timezone });
      onSaved(saved);
    } catch (e) {
      setError(errorText(e));
      setSaving(false);
    }
  }

  const inputStyle = { color: theme.text, background: theme.inputBackground };
  return (
    <form
      className="kleio-form"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      {heading && <h3 className="kleio-h3">{blob ? `Edit ${blob.name}` : "New agent"}</h3>}
      <div className="kleio-form-row">
        <label className="kleio-field kleio-field-grow">
          <span className="modal-label">Name</span>
          <input
            className="modal-input"
            style={inputStyle}
            value={name}
            maxLength={40}
            required
            autoFocus
            placeholder="Chef"
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <label className="kleio-field kleio-field-emoji">
          <span className="modal-label">Emoji</span>
          <input
            className="modal-input"
            style={inputStyle}
            value={emoji}
            aria-describedby="kleio-emoji-picks"
            onChange={(e) => setEmoji(firstGrapheme(e.target.value))}
          />
        </label>
      </div>
      <div
        id="kleio-emoji-picks"
        className="kleio-emoji-picks"
        role="group"
        aria-label="Emoji picks"
      >
        {EMOJI_PICKS.map((e) => (
          <button
            key={e}
            type="button"
            className="kleio-emoji-pick"
            aria-pressed={emoji === e}
            aria-label={`Use ${e}`}
            onClick={() => setEmoji(e)}
          >
            {e}
          </button>
        ))}
      </div>
      <span className="modal-label" id="kleio-colour-label">
        Colour
      </span>
      <div className="kleio-swatches" role="radiogroup" aria-labelledby="kleio-colour-label">
        {BLOB_COLORS.map((c) => (
          <button
            key={c}
            type="button"
            role="radio"
            aria-checked={color === c}
            aria-label={c}
            title={c}
            className="kleio-swatch"
            style={{ background: BLOB_COLOR_HEX[c] }}
            onClick={() => setColor(c)}
          />
        ))}
      </div>
      <label className="kleio-field">
        <span className="modal-label">Job</span>
        <textarea
          className="modal-input kleio-job"
          style={inputStyle}
          value={job}
          maxLength={8000}
          required
          rows={5}
          placeholder="Plan three dinners every Sunday evening from what's in season."
          onChange={(e) => setJob(e.target.value)}
        />
      </label>
      <p className="modal-hint" style={{ color: theme.textMuted }}>
        Timing in the job becomes schedules automatically (in {timezone}).
      </p>
      <span className="modal-label">Brain</span>
      <Dropdown
        label="Brain"
        options={modelOptions(models)}
        value={model}
        onChange={setModel}
        disabled={models === null}
        placeholder="Loading models…"
      />
      {error && (
        <p className="kleio-error" role="alert">
          {error}
        </p>
      )}
      <div className="modal-actions">
        <button type="button" className="modal-btn" onClick={onCancel} disabled={saving}>
          Cancel
        </button>
        <button
          type="submit"
          className="modal-btn primary"
          disabled={saving || !name.trim() || !job.trim()}
        >
          {saving ? (jobChanged ? "Saving… reading the job" : "Saving…") : blob ? "Save" : "Create"}
        </button>
      </div>
    </form>
  );
}

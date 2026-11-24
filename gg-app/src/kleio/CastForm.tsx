// Create / edit a specialist on the desktop, in the Cast's look: who it is on
// the left (the character on its shelf, its name, look and brain), what it does
// on the right (the job, and its schedules once it exists). It holds and saves
// exactly what today's form does (useBlobForm); the iPhone keeps that form.

import { useId, useLayoutEffect, useRef } from "react";
import { CloudIcon, LockSimpleIcon, ShuffleIcon } from "@phosphor-icons/react";
import { Dropdown } from "../Dropdown";
import { BlobAvatar } from "./BlobAvatar";
import {
  BlobFormHead,
  JOB_COUNT_FROM,
  JOB_EXAMPLES,
  JOB_MAX,
  NAME_MAX,
  modelOptions,
  useBlobForm,
  whereItRuns,
  type BlobFormProps,
} from "./BlobForm";
import { freshLook } from "./blobLook";
import { castFoot } from "./castLayout";
import { CastSchedules } from "./CastSchedules";
import { LookRows } from "./LookPicker";
import "./kleio-cast.css";

export function CastForm({
  blob,
  others,
  onSaved,
  onCancel,
  onChanged,
  now,
}: BlobFormProps & {
  /** A schedule changed on the host: read the specialists again. */
  onChanged: () => Promise<void>;
  /** Hold the clock still (tests). */
  now?: Date;
}): React.ReactElement {
  const form = useBlobForm({ ...(blob ? { blob } : {}), ...(others ? { others } : {}), onSaved });
  const { name, look, job, colors, chosen } = form;
  const formId = useId();
  const ids = { form: `${formId}-form`, name: `${formId}-name`, job: `${formId}-job` };
  const jobRef = useRef<HTMLTextAreaElement>(null);

  // The job box is as tall as the job, from three lines up to its CSS limit.
  useLayoutEffect(() => {
    const el = jobRef.current;
    if (!el) return;
    el.style.height = "auto";
    if (el.scrollHeight > 0) el.style.height = `${el.scrollHeight + 2}px`;
  }, [job]);

  return (
    <div className="cast-form">
      <BlobFormHead form={form} formId={ids.form} onCancel={onCancel} />
      <div className="cast-creator">
        <div className="cast-creator-grid">
          {/* The job's fields join this form by its id: the schedules beside
              them save on their own and must not submit it. */}
          <form
            id={ids.form}
            className="cast-who"
            aria-label={form.title}
            onSubmit={(e) => {
              e.preventDefault();
              void form.save();
            }}
          >
            <div className="cast-mini">
              <div className="cast-shelf" aria-hidden="true" />
              <span
                className="cast-slot is-hero"
                aria-hidden="true"
                style={{ "--foot": `${castFoot(look.shape)}%` } as React.CSSProperties}
              >
                <span className="cast-figure">
                  <BlobAvatar look={look} size={124} className="cast-bob" />
                </span>
              </span>
              <button
                type="button"
                className="cast-shuffle"
                aria-label="Shuffle the look"
                title="Shuffle"
                onClick={() => form.setLook(freshLook([look], colors))}
              >
                <ShuffleIcon size={15} weight="bold" aria-hidden="true" />
              </button>
            </div>
            <label className="sr-only" htmlFor={ids.name}>
              Name
            </label>
            <input
              id={ids.name}
              className="cast-name-input"
              value={name}
              maxLength={NAME_MAX}
              required
              autoFocus
              autoComplete="off"
              placeholder="Chef"
              onChange={(e) => form.setName(e.target.value)}
            />
            <div className="cast-pickers">
              <LookRows look={look} colors={colors} onChange={form.setLook} />
              <div className="cast-brain">
                <span className="kleio-label">Brain</span>
                <Dropdown
                  label="Brain"
                  options={modelOptions(form.models)}
                  value={form.model}
                  onChange={form.setModel}
                  disabled={form.models === null}
                  placeholder="Loading models…"
                />
                {chosen && (
                  <p className="cast-note">
                    {chosen.private ? (
                      <LockSimpleIcon size={13} weight="bold" aria-hidden="true" />
                    ) : (
                      <CloudIcon size={13} weight="bold" aria-hidden="true" />
                    )}
                    {whereItRuns(chosen)}.
                  </p>
                )}
              </div>
            </div>
          </form>

          <div className="cast-what">
            <section className="cast-card">
              <div className="cast-card-head">
                <label className="cast-label" htmlFor={ids.job}>
                  Job
                </label>
                <span className="cast-hint">
                  One job, in plain words. Say when it should happen and what to send back.
                </span>
              </div>
              <textarea
                ref={jobRef}
                id={ids.job}
                form={ids.form}
                className="cast-job-text"
                value={job}
                maxLength={JOB_MAX}
                required
                rows={3}
                placeholder="Plan three dinners every Sunday evening from what's in season."
                onChange={(e) => form.setJob(e.target.value)}
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
                      onClick={() => form.setJob(x.job)}
                    >
                      {x.label}
                    </button>
                  ))}
                </div>
              )}
              <div className="kleio-setting">
                <span className="kleio-setting-text">
                  <span className="kleio-setting-name">Read timing from the job</span>
                  <span className="kleio-setting-desc">
                    {blob
                      ? "When the job changes, “every weekday at 7:30” replaces its earlier automatic schedules. Ones you added yourself stay."
                      : "“Every weekday at 7:30” becomes a schedule you can change later."}
                  </span>
                </span>
                <label className="cast-switch">
                  <input
                    type="checkbox"
                    checked={form.readTiming}
                    onChange={(e) => form.setReadTiming(e.target.checked)}
                    aria-label="Read timing from the job"
                  />
                  <span />
                </label>
              </div>
            </section>
            <CastSchedules
              {...(blob ? { blob } : {})}
              onChanged={onChanged}
              {...(now ? { now } : {})}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

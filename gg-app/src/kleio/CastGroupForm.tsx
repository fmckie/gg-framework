// Create / edit a group, in the Cast's look: who is in it on the
// left (its members standing on a shelf, and its name), how it is made up on the
// right (the specialists to tick, how a group chat works, and deleting it). It
// holds and saves exactly what today's form does (useGroupForm), less the
// colour picker: a group's colour only outlines one whose members are all gone,
// so the saved colour is kept and sent as it was. No mockup draws this page: it
// is put together from the specialist form's parts (CastForm.tsx). The iPhone
// keeps today's form (GroupsPage.tsx).

import { useId, useState } from "react";
import { CheckIcon, TrashIcon } from "@phosphor-icons/react";
import { ConfirmModal } from "../ConfirmModal";
import { MetalButton } from "../MetalButton";
import { useWindowFocused } from "../useWindowFocused";
import { AgentAvatar, BlobOutline } from "./BlobAvatar";
import { lookOf } from "./blobLook";
import { castFoot } from "./castLayout";
import {
  GROUP_NAME_MAX,
  HOW_IT_WORKS,
  MAX_MEMBERS,
  useGroupForm,
  type GroupFormProps,
} from "./groupParts";
import { KleioHead } from "./KleioChrome";
import "./kleio-cast.css";

const footOf = (percent: number): React.CSSProperties =>
  ({ "--foot": `${percent}%` }) as React.CSSProperties;

export function CastGroupForm({
  group,
  blobs,
  onSaved,
  onCancel,
  onDeleted,
}: GroupFormProps): React.ReactElement {
  const { name, setName, members, toggle, error, full, canSave, title, saveLabel, ...form } =
    useGroupForm({ ...(group ? { group } : {}), blobs, onSaved, onDeleted });
  const { save, remove, missing, chosen } = form;
  const [confirmDelete, setConfirmDelete] = useState(false);
  const windowFocused = useWindowFocused();
  const formId = useId();
  const ids = { form: `${formId}-form`, name: `${formId}-name` };

  return (
    <div className="cast-form cast-gform">
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
              {saveLabel}
            </MetalButton>
          </>
        }
      />
      {error && (
        <p className="kleio-error kleio-page-error" role="alert">
          {error}
        </p>
      )}
      <div className="cast-creator">
        <div className="cast-creator-grid">
          <form
            id={ids.form}
            className="cast-who"
            aria-label={title}
            onSubmit={(e) => {
              e.preventDefault();
              void save();
            }}
          >
            <div
              className="cast-mini cast-gstage"
              aria-hidden="true"
              style={{ "--n": Math.max(1, chosen.length) } as React.CSSProperties}
            >
              <div className="cast-shelf" />
              {chosen.length === 0 ? (
                <span className="cast-slot is-place" style={footOf(castFoot("orb"))}>
                  <span className="cast-figure">
                    <BlobOutline shape="orb" size={96} />
                  </span>
                </span>
              ) : (
                chosen.map((b) => (
                  <span key={b.id} className="cast-slot" style={footOf(castFoot(lookOf(b).shape))}>
                    <span className="cast-figure">
                      <AgentAvatar agent={b} size={96} />
                    </span>
                  </span>
                ))
              )}
            </div>
            <label className="sr-only" htmlFor={ids.name}>
              Name
            </label>
            <input
              id={ids.name}
              className="cast-name-input"
              value={name}
              maxLength={GROUP_NAME_MAX}
              required
              autoFocus
              autoComplete="off"
              placeholder="Kitchen crew"
              onChange={(e) => setName(e.target.value)}
            />
            <p className="cast-gform-who">
              {members.length ? chosen.map((b) => b.name).join(", ") : "Pick its members."}
            </p>
          </form>

          <div className="cast-what">
            <section className="cast-card">
              <div className="cast-card-head">
                <h2 className="cast-label">
                  Members
                  <span className="cast-count">{members.length}</span>
                </h2>
                <span className="cast-hint">Pick up to {MAX_MEMBERS} specialists.</span>
              </div>
              {blobs.length === 0 && missing.length === 0 ? (
                <p className="kleio-empty">No specialists yet — create one first.</p>
              ) : (
                <ul className="kleio-member-picks" aria-label="Members">
                  {blobs.map((b) => {
                    const on = members.includes(b.id);
                    return (
                      <li key={b.id}>
                        <button
                          type="button"
                          className="kleio-member-pick"
                          aria-pressed={on}
                          disabled={!on && full}
                          onClick={() => toggle(b.id)}
                        >
                          <AgentAvatar agent={b} size={30} />
                          <span className="kleio-member-text">
                            <span className="kleio-member-name">{b.name}</span>
                            <span className="kleio-member-sub">{b.job}</span>
                          </span>
                          <span className="kleio-check" aria-hidden="true">
                            {on && <CheckIcon size={12} weight="bold" />}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                  {missing.map((id) => (
                    <li key={id}>
                      <button
                        type="button"
                        className="kleio-member-pick is-missing"
                        aria-pressed={true}
                        onClick={() => toggle(id)}
                      >
                        <span className="kleio-member-gone" aria-hidden="true" />
                        <span className="kleio-member-text">
                          <span className="kleio-member-name">Deleted specialist</span>
                          <span className="kleio-member-sub">
                            Click to remove it from the group.
                          </span>
                        </span>
                        <span className="kleio-check" aria-hidden="true">
                          <CheckIcon size={12} weight="bold" />
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <p className="kleio-count-line">
                {members.length} of {MAX_MEMBERS}
                {full ? " — the group is full" : ""}
              </p>
            </section>

            <section className="cast-card">
              <div className="cast-card-head">
                <h2 className="cast-label">How it works</h2>
              </div>
              <ul className="kleio-howto">
                {HOW_IT_WORKS.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </section>

            {group && (
              <section className="cast-card">
                <div className="cast-card-head">
                  <h2 className="cast-label">Delete group</h2>
                  <span className="cast-hint">Removes the group chat. Its specialists stay.</span>
                </div>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm kleio-danger-btn"
                  onClick={() => setConfirmDelete(true)}
                >
                  <TrashIcon size={14} weight="bold" aria-hidden="true" />
                  Delete {group.name}
                </button>
              </section>
            )}
          </div>
        </div>
      </div>
      {group && confirmDelete && (
        <ConfirmModal
          title={`Delete ${group.name}?`}
          message="The group chat and its messages go. Its specialists stay. This can't be undone."
          confirmLabel="Delete"
          onConfirm={() => void remove()}
          onClose={() => setConfirmDelete(false)}
        />
      )}
    </div>
  );
}

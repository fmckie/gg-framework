// Choosing an agent's look: a large live preview with a Shuffle button, then
// three rows of choices — Shape, Face, Colour — each drawn as a small blob so
// the choice is visible, not described. Every row is a radio group: Tab moves
// between rows, the arrow keys move within one (roving tabindex).

import { useId, useRef } from "react";
import { ShuffleIcon } from "@phosphor-icons/react";
import { BlobAvatar } from "./BlobAvatar";
import {
  BLOB_COLOR_LABEL,
  BLOB_FACES,
  BLOB_SHAPES,
  FACE_LABEL,
  SHAPE_LABEL,
  freshLook,
  type BlobLook,
} from "./blobLook";
import type { BlobColor } from "./kleioApi";

function LookRow<T extends string>({
  label,
  options,
  value,
  labelOf,
  render,
  onPick,
}: {
  label: string;
  options: readonly T[];
  value: T;
  labelOf: (v: T) => string;
  render: (v: T) => React.ReactNode;
  onPick: (v: T) => void;
}): React.ReactElement {
  const labelId = useId();
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  function move(from: number, delta: number): void {
    const next = (from + delta + options.length) % options.length;
    const v = options[next];
    if (v === undefined) return;
    onPick(v);
    refs.current[next]?.focus();
  }

  return (
    <div className="kleio-look-row">
      <span className="kleio-label" id={labelId}>
        {label}
        <span className="kleio-look-current">{labelOf(value)}</span>
      </span>
      <div className="kleio-look-options" role="radiogroup" aria-labelledby={labelId}>
        {options.map((o, i) => {
          const on = o === value;
          return (
            <button
              key={o}
              ref={(el) => {
                refs.current[i] = el;
              }}
              type="button"
              role="radio"
              aria-checked={on}
              aria-label={labelOf(o)}
              title={labelOf(o)}
              tabIndex={on ? 0 : -1}
              className="kleio-look-option"
              onClick={() => onPick(o)}
              onKeyDown={(e) => {
                if (e.key === "ArrowRight" || e.key === "ArrowDown") {
                  e.preventDefault();
                  move(i, 1);
                } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
                  e.preventDefault();
                  move(i, -1);
                }
              }}
            >
              {render(o)}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function LookPicker({
  look,
  colors,
  onChange,
}: {
  look: BlobLook;
  /** The colours this host accepts (older hosts: the original six). */
  colors: readonly BlobColor[];
  onChange: (look: BlobLook) => void;
}): React.ReactElement {
  return (
    <div className="kleio-look">
      <div className="kleio-look-stage">
        <BlobAvatar look={look} size={112} animated />
        <button
          type="button"
          className="btn btn-ghost btn-sm kleio-look-shuffle"
          onClick={() => onChange(freshLook([look], colors))}
        >
          <ShuffleIcon size={14} weight="bold" aria-hidden="true" />
          Shuffle
        </button>
      </div>
      <div className="kleio-look-rows">
        <LookRow
          label="Shape"
          options={BLOB_SHAPES}
          value={look.shape}
          labelOf={(s) => SHAPE_LABEL[s]}
          render={(s) => <BlobAvatar look={{ ...look, shape: s }} size={34} />}
          onPick={(shape) => onChange({ ...look, shape })}
        />
        <LookRow
          label="Face"
          options={BLOB_FACES}
          value={look.face}
          labelOf={(f) => FACE_LABEL[f]}
          render={(f) => <BlobAvatar look={{ ...look, shape: "orb", face: f }} size={34} />}
          onPick={(face) => onChange({ ...look, face })}
        />
        <LookRow
          label="Colour"
          options={colors}
          value={look.color}
          labelOf={(c) => BLOB_COLOR_LABEL[c]}
          render={(c) => <BlobAvatar look={{ ...look, color: c }} size={34} />}
          onPick={(color) => onChange({ ...look, color })}
        />
      </div>
    </div>
  );
}

import { useEffect, useState } from "react";
import { LAUREL_LEAF, LAUREL_LEAVES, LAUREL_WORDS, type Stele } from "./goal-stele";
import { copyStele, type SteleCopy } from "./stele-image";
import "./placeholder.css";

type Said = "idle" | "busy" | SteleCopy;

/** What the Copy button says, by how the last copy went. */
const SAID: Readonly<Record<Said, string>> = {
  idle: "Copy as image",
  busy: "Copy as image",
  copied: "Copied",
  opened: "Opened in your image viewer",
  failed: "Couldn't copy the picture",
};

function LaurelMark(): React.ReactElement {
  return (
    <svg className="goal-stele-mark" viewBox="0 0 16 16" width={16} height={16} aria-hidden="true">
      {LAUREL_LEAVES.map((leaf) => (
        <ellipse
          key={`${leaf.x} ${leaf.y}`}
          cx={leaf.x}
          cy={leaf.y}
          rx={LAUREL_LEAF.rx}
          ry={LAUREL_LEAF.ry}
          transform={`rotate(${leaf.deg} ${leaf.x} ${leaf.y})`}
        />
      ))}
    </svg>
  );
}

/**
 * The stele: a finished stretch's account under the courtyard. A marble cap
 * with the outcome, a line for each worker brought in (the crowned one with
 * its laurel), then the finish card's totals beside Copy as image, which puts
 * a picture of the stele on the clipboard.
 */
export function GoalStele({ stele }: { stele: Stele }): React.ReactElement {
  const [said, setSaid] = useState<Said>("idle");
  useEffect(() => {
    if (said === "idle" || said === "busy") return;
    const id = window.setTimeout(() => setSaid("idle"), said === "copied" ? 1500 : 4000);
    return () => window.clearTimeout(id);
  }, [said]);
  return (
    <section
      className="goal-stele"
      aria-label={`${stele.title}: each worker's account`}
      data-outcome={stele.outcome}
    >
      <header className="goal-stele-cap">
        <h3 className="goal-stele-title">{stele.title}</h3>
      </header>
      {stele.lines.length > 0 ? (
        <table className="goal-stele-table">
          <thead>
            <tr>
              <th scope="col">Worker</th>
              <th scope="col">Ended</th>
              <th scope="col">Time</th>
              <th scope="col">Tools used</th>
              <th scope="col">Tokens</th>
            </tr>
          </thead>
          <tbody>
            {stele.lines.map((line) => (
              <tr
                key={line.key}
                className={line.laurel ? "is-laurel" : undefined}
                data-key={line.key}
                data-status={line.status}
              >
                <th scope="row">
                  <span className="goal-stele-worker">
                    <img
                      className="goal-worker-cameo"
                      src={line.god.cameo}
                      alt=""
                      width={24}
                      height={32}
                      draggable={false}
                    />
                    <span className="goal-stele-who">
                      <span className="goal-stele-name">
                        {line.name}
                        {line.laurel && <LaurelMark />}
                      </span>
                      {line.laurel && <span className="goal-stele-laurel">{LAUREL_WORDS}</span>}
                    </span>
                  </span>
                </th>
                <td>{line.ending}</td>
                <td>{line.time}</td>
                <td>{line.tools}</td>
                <td>{line.tokens}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="goal-stele-none placeholder-muted">No workers were brought in.</p>
      )}
      <footer className="goal-stele-foot">
        <dl className="goal-stele-totals">
          {stele.totals.map((total) => (
            <div key={total.label}>
              <dt className="placeholder-muted">{total.label}</dt>
              <dd>{total.value}</dd>
            </div>
          ))}
        </dl>
        <button
          type="button"
          className="goal-stele-copy"
          aria-busy={said === "busy"}
          onClick={() => {
            if (said === "busy") return;
            setSaid("busy");
            void copyStele(stele).then(setSaid, () => setSaid("failed"));
          }}
        >
          {SAID[said]}
        </button>
      </footer>
    </section>
  );
}

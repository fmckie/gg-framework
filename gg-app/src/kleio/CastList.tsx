// Specialists, as a cast: everyone stands on a lit shelf. The
// one working bounces, the paused ones sleep, and whoever needs you says so in
// a bubble. Clicking a character puts it in the spotlight and shows its profile
// underneath; the profile opens its chat or its form, runs its schedule now or
// turns its schedules back on.

import { useEffect, useId, useRef, useState } from "react";
import {
  ArrowRightIcon,
  CheckIcon,
  CloudIcon,
  LockSimpleIcon,
  MagnifyingGlassIcon,
  PencilSimpleIcon,
  PlayIcon,
  WarningCircleIcon,
  XIcon,
} from "@phosphor-icons/react";
import { MetalButton } from "../MetalButton";
import { isPhone } from "../platform";
import { ListSkeleton } from "../Skeleton";
import { buildSummaryLineParts } from "../tool-format";
import { useWindowFocused } from "../useWindowFocused";
import { AgentAvatar, BlobAvatar, BlobOutline } from "./BlobAvatar";
import { JOB_EXAMPLES, whereItRunsShort } from "./BlobForm";
import { describeSchedule, formatClock, formatWhen, plainSummary } from "./blobFormat";
import { castFoot, castKind, castOf, castOffer, SHELVES_SHOWN, type CastActor } from "./castLayout";
import { ClampText } from "./ClampText";
import { AppsButton, KleioHead } from "./KleioChrome";
import { LIVE_TOOL_ROWS, ToolCallRow } from "./LiveToolFeed";
import {
  errorText,
  getBlobActivity,
  listModels,
  listRuns,
  runScheduleNow,
  updateSchedule,
  type Blob,
  type ModelList,
  type Run,
  type ToolActivityEntry,
} from "./kleioApi";
import "./kleio-cast.css";

/** Finished runs the profile lists. */
const RUNS_SHOWN = 2;
/** How often the shelf's "today" and "tomorrow" are read again. */
const CLOCK_MS = 30_000;
/** How long the profile says a run has started. */
const STARTED_MS = 2500;
/** The first run's example jobs (JOB_EXAMPLES), each with a place's outline. */
const EXAMPLE_SHAPES = ["orb", "mochi", "drop"] as const;

const vars = (v: Record<string, string | number>): React.CSSProperties => v as React.CSSProperties;

/** The time now, read again every `everyMs`; `pinned` holds it still. */
function useClock(pinned: Date | undefined, everyMs: number): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    if (pinned) return;
    const id = window.setInterval(() => setNow(new Date()), everyMs);
    return () => window.clearInterval(id);
  }, [pinned, everyMs]);
  return pinned ?? now;
}

interface Read<T> {
  id: string;
  value?: T;
  error?: string;
}

/** One read for the selected specialist, again whenever the list refreshes. */
function useRead<T>(
  id: string | null,
  refresh: unknown,
  load: (id: string) => Promise<T>,
): Read<T> | null {
  const [read, setRead] = useState<Read<T> | null>(null);
  useEffect(() => {
    if (!id) return;
    let live = true;
    load(id).then(
      (value) => {
        if (live) setRead({ id, value });
      },
      (e: unknown) => {
        if (live) setRead({ id, error: errorText(e) });
      },
    );
    return () => {
      live = false;
    };
  }, [id, refresh, load]);
  return read && read.id === id ? read : null;
}

export function CastList({
  blobs,
  error,
  hostLabel,
  onClose,
  onCreate,
  onCreateFrom,
  onChanged,
  onOpen,
  onEdit,
  onOpenApps,
  now,
  loadRuns = listRuns,
  loadActivity = getBlobActivity,
  loadModels = listModels,
  runNow = runScheduleNow,
  setEnabled = (id, sid, enabled) => updateSchedule(id, sid, { enabled }),
}: {
  blobs: Blob[] | null;
  error: string | null;
  /** The host's short name, for the first run's "I'll do it on …". */
  hostLabel: string;
  onClose: () => void;
  onCreate: () => void;
  /** A new specialist starting from one of the first run's example jobs. */
  onCreateFrom: (job: string) => void;
  /** The profile ran or switched on a schedule: read the specialists again. */
  onChanged: () => Promise<void>;
  /** Open this specialist's chat. */
  onOpen: (id: string) => void;
  onEdit: (id: string) => void;
  onOpenApps?: () => void;
  /** Hold the clock still (tests). */
  now?: Date;
  loadRuns?: (id: string) => Promise<Run[]>;
  loadActivity?: (id: string) => Promise<ToolActivityEntry[]>;
  loadModels?: () => Promise<ModelList>;
  runNow?: (id: string, scheduleId: string) => Promise<unknown>;
  setEnabled?: (id: string, scheduleId: string, enabled: boolean) => Promise<unknown>;
}): React.ReactElement {
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [picked, setPicked] = useState<string | null>(null);
  const [models, setModels] = useState<ModelList | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const windowFocused = useWindowFocused();
  const clock = useClock(now, CLOCK_MS);

  const all = blobs ?? [];
  const some = all.length > 0;
  const q = query.trim().toLowerCase();
  const shown = all.filter(
    (b) => !q || b.name.toLowerCase().includes(q) || b.job.toLowerCase().includes(q),
  );
  const { layout, actors } = castOf(shown, clock);
  // The spotlight starts on whoever is working.
  const selected =
    actors.find((a) => a.blob.id === picked) ??
    actors.find((a) => a.kind === "working") ??
    actors[0] ??
    null;
  const working = all.filter((b) => b.running).length;
  const failed = all.filter((b) => castKind(b) === "failed").length;
  const loading = blobs === null && !error;

  const selectedId = selected?.blob.id ?? null;
  const runs = useRead(selected && selected.kind !== "oncall" ? selectedId : null, blobs, loadRuns);
  const tools = useRead(selected?.kind === "working" ? selectedId : null, blobs, loadActivity);

  useEffect(() => {
    if (!some) return;
    let live = true;
    loadModels().then(
      (m) => {
        if (live) setModels(m);
      },
      // The profile just leaves the model line out.
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [some, loadModels]);

  useEffect(() => {
    if (searching) searchRef.current?.focus();
  }, [searching]);

  function closeSearch(): void {
    setSearching(false);
    setQuery("");
  }

  const calls = tools?.value ?? [];
  const liveCall = [...calls].reverse().find((e) => e.status === "running");
  const oneShelf = layout.tier === "solo" || layout.tier === "one";
  // The place for the next specialist is for a cast of one, not a search that found one.
  const place = layout.tier === "solo" && all.length === 1;
  const cols = layout.tier === "solo" && !place ? 1 : layout.cols;

  return (
    <>
      <KleioHead
        onBack={onClose}
        title="Specialists"
        status={
          some && (
            <>
              <span className="cast-pills">
                <span className="cast-pill">{all.length}</span>
                {working > 0 && (
                  <span className="cast-pill is-live">
                    <span className="cast-dot" aria-hidden="true" />
                    {working}
                    <span className="cast-pill-word"> working</span>
                  </span>
                )}
                {failed > 0 && (
                  <span className="cast-pill is-failed">
                    <WarningCircleIcon size={13} weight="bold" aria-hidden="true" />
                    {failed}
                    <span className="cast-pill-word">{` ${failed === 1 ? "needs" : "need"} you`}</span>
                  </span>
                )}
              </span>
              {searching && (
                <input
                  ref={searchRef}
                  type="search"
                  className="picker-search"
                  placeholder={"Search specialists…"}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Escape") closeSearch();
                  }}
                  aria-label="Search specialists"
                />
              )}
            </>
          )
        }
        phoneMenu={[
          ...(some
            ? [
                {
                  label: searching ? "Close search" : "Search specialists",
                  onSelect: () => (searching ? closeSearch() : setSearching(true)),
                },
              ]
            : []),
          ...(onOpenApps ? [{ label: "Connect apps", onSelect: onOpenApps }] : []),
          ...(some || blobs === null ? [{ label: "New specialist", onSelect: onCreate }] : []),
        ]}
        actions={
          <>
            {some && (
              <button
                type="button"
                className="btn btn-ghost btn-sm kleio-icon-btn"
                onClick={() => (searching ? closeSearch() : setSearching(true))}
                aria-label={searching ? "Close search" : "Search specialists"}
                aria-expanded={searching}
              >
                {searching ? (
                  <XIcon size={14} weight="bold" aria-hidden="true" />
                ) : (
                  <MagnifyingGlassIcon size={14} weight="bold" aria-hidden="true" />
                )}
              </button>
            )}
            {onOpenApps && <AppsButton onClick={onOpenApps} />}
            {(some || blobs === null) && (
              <MetalButton
                windowFocused={windowFocused}
                className="btn btn-primary btn-sm"
                onClick={onCreate}
              >
                + New specialist
              </MetalButton>
            )}
          </>
        }
      />

      <div className="cast-page" data-tier={layout.tier} style={vars({ "--cols": cols })}>
        {loading && <ListSkeleton rows={4} />}
        {error && (
          <p className="kleio-error cast-error" role="alert">
            {error}
          </p>
        )}
        {blobs !== null && !some && (
          <FirstRun
            hostLabel={hostLabel}
            onCreate={onCreate}
            onCreateFrom={onCreateFrom}
            windowFocused={windowFocused}
          />
        )}
        {some && shown.length === 0 && (
          <div className="picker-empty cast-none">No specialists match “{query.trim()}”.</div>
        )}
        {selected && (
          <>
            <div
              className="cast"
              role="group"
              aria-label={`${q ? "Matching" : "Your"} ${shown.length} ${
                shown.length === 1 ? "specialist" : "specialists"
              }`}
              {...(layout.rows.length > SHELVES_SHOWN ? { "data-scroll": "" } : {})}
            >
              {layout.rows.map((size, row) => (
                <div
                  key={row}
                  className="cast-row"
                  {...(layout.tier !== "solo" && size !== layout.cols
                    ? { style: vars({ "--n": size }) }
                    : {})}
                >
                  <div className="cast-shelf" aria-hidden="true" />
                  {actors
                    .filter((a) => a.row === row)
                    .map((a) => (
                      <Actor
                        key={a.blob.id}
                        actor={a}
                        selected={a === selected}
                        saying={
                          a === selected && oneShelf && liveCall
                            ? (buildSummaryLineParts(liveCall.name, "", false)[0]?.text ?? "")
                            : ""
                        }
                        onSelect={() => setPicked(a.blob.id)}
                      />
                    ))}
                  {place && (
                    <button type="button" className="cast-actor is-add" onClick={onCreate}>
                      <span className="cast-figure">
                        <BlobOutline shape="orb" size={124} />
                      </span>
                      <span className="cast-name">New specialist</span>
                      <span className="cast-state">Give it a job</span>
                    </button>
                  )}
                </div>
              ))}
            </div>
            {layout.hidden > 0 && (
              <p className="cast-more">{`${layout.hidden} more below · scroll`}</p>
            )}
            <Profile
              actor={selected}
              shelves={layout.rows.length}
              runs={runs}
              calls={calls}
              models={models}
              {...(now ? { now } : {})}
              clock={clock}
              windowFocused={windowFocused}
              onOpen={() => onOpen(selected.blob.id)}
              onEdit={() => onEdit(selected.blob.id)}
              onChanged={onChanged}
              runNow={runNow}
              setEnabled={setEnabled}
            />
          </>
        )}
      </div>
    </>
  );
}

// ─── one character on the shelf ───────────────────────────────────────────

function Actor({
  actor,
  selected,
  saying,
  onSelect,
}: {
  actor: CastActor;
  selected: boolean;
  /** What it's doing this moment, for a bubble; "" for none. */
  saying: string;
  onSelect: () => void;
}): React.ReactElement {
  const { blob, kind } = actor;
  const why = kind === "failed" ? blob.lastRun?.error?.trim() || actor.state : "";
  return (
    <button
      type="button"
      className={`cast-actor is-${kind}`}
      aria-pressed={selected}
      aria-label={`${blob.name}. ${actor.state}. ${blob.job}`}
      onClick={onSelect}
      style={vars({
        "--foot": `${actor.foot}%`,
        ...(actor.beat !== undefined ? { "--bd": `${actor.beat.toFixed(2)}s` } : {}),
      })}
      {...(actor.clock ? { "data-clock": actor.clock } : {})}
    >
      {saying && (
        <span className="cast-bubble">
          <span className="cast-dot" aria-hidden="true" />
          {`${saying}…`}
        </span>
      )}
      {why && (
        <span className="cast-bubble" title={why}>
          <WarningCircleIcon size={13} weight="bold" aria-hidden="true" />
          <span className="cast-btxt">{why}</span>
        </span>
      )}
      {kind === "paused" && (
        <span className="cast-zz" aria-hidden="true">
          <i>z</i>
          <i>z</i>
        </span>
      )}
      <span className="cast-figure">
        <AgentAvatar
          agent={blob}
          size={84}
          live={kind === "working"}
          animated={Boolean(actor.clock)}
        />
      </span>
      <span className="cast-name">{blob.name}</span>
      <span className="cast-state">{actor.label}</span>
    </button>
  );
}

// ─── the selected character's profile, under the shelves ──────────────────

function RunLine({ run, now }: { run: Run; now: Date }): React.ReactElement {
  const failed = run.outcome === "error";
  return (
    <>
      {failed ? (
        <WarningCircleIcon size={13} weight="bold" aria-label="Failed" />
      ) : run.outcome === "skipped" ? (
        <ArrowRightIcon size={13} weight="bold" aria-label="Skipped" />
      ) : (
        <CheckIcon size={13} weight="bold" aria-label="Done" />
      )}
      <span>
        <time dateTime={run.startedAt}>{formatWhen(run.startedAt, now)}</time>{" "}
        {run.summary ? plainSummary(run.summary) : (run.error ?? "")}
      </span>
    </>
  );
}

/** The calls of the turn under way, with their seconds counting. */
function RightNow({
  name,
  calls,
  now,
}: {
  name: string;
  calls: readonly ToolActivityEntry[];
  now?: Date;
}): React.ReactElement {
  const clock = useClock(now, 1000);
  return (
    <ol className="cast-tools" aria-label={`${name}’s tool calls, oldest first`}>
      {calls.slice(-LIVE_TOOL_ROWS).map((entry) => (
        <ToolCallRow key={entry.id} as="li" entry={entry} nowMs={clock.getTime()} />
      ))}
    </ol>
  );
}

function Profile({
  actor,
  shelves,
  runs,
  calls,
  models,
  now,
  clock,
  windowFocused,
  onOpen,
  onEdit,
  onChanged,
  runNow,
  setEnabled,
}: {
  actor: CastActor;
  shelves: number;
  runs: Read<Run[]> | null;
  calls: readonly ToolActivityEntry[];
  models: ModelList | null;
  now?: Date;
  clock: Date;
  windowFocused: boolean;
  onOpen: () => void;
  onEdit: () => void;
  onChanged: () => Promise<void>;
  runNow: (id: string, scheduleId: string) => Promise<unknown>;
  setEnabled: (id: string, scheduleId: string, enabled: boolean) => Promise<unknown>;
}): React.ReactElement {
  const { blob, kind } = actor;
  // What its button is doing, for the one it was pressed on: the profile
  // stays in place while the spotlight moves, so this must not follow it.
  const [act, setAct] = useState<{
    id: string;
    busy?: boolean;
    started?: boolean;
    error?: string;
  } | null>(null);
  const mine = act?.id === blob.id ? act : null;
  const busy = Boolean(mine?.busy);
  // The phone leads with who it is and what to do; the rest is behind Details.
  const phone = isPhone();
  const [details, setDetails] = useState(false);
  const detailsId = useId();
  const secondary = !phone || details;
  const offer = castOffer(blob);
  const lead = offer?.kind === "resume" || Boolean(offer?.kind === "run" && offer.lead);

  useEffect(() => {
    if (!act?.started) return;
    const id = window.setTimeout(() => setAct(null), STARTED_MS);
    return () => window.clearTimeout(id);
  }, [act]);

  async function press(work: () => Promise<unknown>, started: boolean): Promise<void> {
    const id = blob.id;
    setAct({ id, busy: true });
    try {
      await work();
      await onChanged();
      setAct(started ? { id, started } : null);
    } catch (e) {
      setAct({ id, error: errorText(e) });
    }
  }

  const chat = (first: boolean): React.ReactElement =>
    first ? (
      <MetalButton
        windowFocused={windowFocused}
        className="btn btn-primary btn-sm"
        onClick={onOpen}
      >
        Open chat
      </MetalButton>
    ) : (
      <button type="button" className="btn btn-ghost btn-sm" onClick={onOpen}>
        Open chat
      </button>
    );
  const edit = (
    <button type="button" className="btn btn-ghost btn-sm" onClick={onEdit}>
      <PencilSimpleIcon size={14} weight="bold" aria-hidden="true" />
      Edit
    </button>
  );
  const run = offer?.kind === "run" && {
    title: `Run “${offer.schedule.label}” now`,
    disabled: busy,
    onClick: () => void press(() => runNow(blob.id, offer.schedule.id), true),
    children: (
      <>
        <PlayIcon size={12} weight="fill" aria-hidden="true" />
        {busy ? "Starting…" : "Run now"}
      </>
    ),
  };
  const ended = (runs?.value ?? []).filter((r) => r.endedAt);
  const model = models?.models.find((m) => m.id === (blob.model ?? models.defaultBlobModel));
  const since =
    kind === "working" && blob.lastRun && !blob.lastRun.endedAt
      ? formatClock(blob.lastRun.startedAt)
      : "";
  const showCalls = kind === "working" && calls.length > 0;
  const lastRun = showCalls ? ended[0] : undefined;

  const error = mine?.error && (
    <p className="kleio-error cast-p-error" role="alert">
      {mine.error}
    </p>
  );
  const actions = (
    <div className="cast-p-actions">
      {offer?.kind === "resume" && (
        <MetalButton
          windowFocused={windowFocused}
          className="btn btn-primary btn-sm"
          disabled={busy}
          onClick={() =>
            void press(
              () => Promise.all(offer.schedules.map((s) => setEnabled(blob.id, s.id, true))),
              false,
            )
          }
        >
          {busy
            ? "Turning on…"
            : offer.schedules.length === 1
              ? "Turn schedule on"
              : "Turn schedules on"}
        </MetalButton>
      )}
      {run && lead && (
        <MetalButton windowFocused={windowFocused} className="btn btn-primary btn-sm" {...run} />
      )}
      {chat(!lead)}
      {edit}
      {run && !lead && <button type="button" className="btn btn-ghost btn-sm" {...run} />}
      {mine?.started && (
        <span className="cast-p-started" role="status">
          Started. The result will show in Recent runs.
        </span>
      )}
    </div>
  );
  return (
    <section
      className="cast-profile"
      aria-label={blob.name}
      style={vars({ "--col": actor.col, "--notch": actor.front ? 1 : 0 })}
    >
      <div className="cast-p-id">
        <div className="cast-p-head">
          {(shelves > 1 || phone) && <AgentAvatar agent={blob} size={36} />}
          <h2>{blob.name}</h2>
        </div>
        <p className="cast-p-state">
          {kind === "working" ? (
            <span className="cast-pill is-live">
              <span className="cast-dot" aria-hidden="true" />
              {actor.state}
            </span>
          ) : kind === "failed" ? (
            <span className="cast-pill is-failed">
              <WarningCircleIcon size={13} weight="bold" aria-hidden="true" />
              {actor.state}
            </span>
          ) : (
            <span className="cast-pill">{actor.state}</span>
          )}
          {since && <span>{`since ${since}`}</span>}
        </p>
        <ClampText key={blob.id} className="cast-p-job">
          {blob.job}
        </ClampText>
        {secondary && model && (
          <p className="cast-p-brain">
            {model.private ? (
              <LockSimpleIcon size={13} weight="bold" aria-hidden="true" />
            ) : (
              <CloudIcon size={13} weight="bold" aria-hidden="true" />
            )}
            {`${blob.model === null ? "Default · " : ""}${model.label} · ${whereItRunsShort(model)}`}
          </p>
        )}
      </div>

      {phone && error}
      {phone && actions}
      {phone && (
        <button
          type="button"
          className="btn btn-ghost btn-sm cast-p-more"
          aria-expanded={details}
          aria-controls={`${detailsId} ${detailsId}-2`}
          onClick={() => setDetails((d) => !d)}
        >
          {details ? "Hide details" : "Details"}
        </button>
      )}
      {secondary && (
        <>
          <div className="cast-p-col" {...(phone ? { id: detailsId } : {})}>
            {showCalls ? (
              <>
                <h3 className="cast-label">Right now</h3>
                <RightNow name={blob.name} calls={calls} {...(now ? { now } : {})} />
              </>
            ) : kind === "oncall" ? (
              <>
                <h3 className="cast-label">How to use it</h3>
                <p className="cast-p-note">
                  Ask it anything about its job. This chat is shared with your phone.
                </p>
              </>
            ) : (
              <>
                <h3 className="cast-label">Recent runs</h3>
                {runs?.error ? (
                  <p className="cast-p-note">{runs.error}</p>
                ) : !runs ? (
                  <p className="cast-p-note">Loading…</p>
                ) : ended.length === 0 ? (
                  <p className="cast-p-note">Nothing has run yet.</p>
                ) : (
                  <ol className="cast-runs">
                    {ended.slice(0, RUNS_SHOWN).map((r) => (
                      <li key={r.id} className={r.outcome === "error" ? "is-failed" : undefined}>
                        <RunLine run={r} now={clock} />
                      </li>
                    ))}
                  </ol>
                )}
              </>
            )}
          </div>

          <div className="cast-p-col" {...(phone ? { id: `${detailsId}-2` } : {})}>
            <h3 className="cast-label">{blob.schedules.length === 1 ? "Schedule" : "Schedules"}</h3>
            {blob.schedules.length === 0 ? (
              <p className="cast-p-note">
                No schedules. Mention timing in the job (“every weekday at 7:30”) or add one.
              </p>
            ) : (
              <ul className="cast-scheds">
                {blob.schedules.map((s) => (
                  <li key={s.id}>
                    <p className="cast-s-name">
                      {s.label}
                      {s.source === "auto" && <span className="cast-tag">Auto</span>}
                    </p>
                    <p className="cast-s-when">
                      {describeSchedule(s)}
                      {s.enabled
                        ? s.nextRunAt
                          ? ` · next ${formatWhen(s.nextRunAt, clock)}`
                          : ""
                        : " · off"}
                    </p>
                  </li>
                ))}
              </ul>
            )}
            {lastRun && (
              <>
                <h3 className="cast-label">Last run</h3>
                <p className="cast-s-last">
                  <RunLine run={lastRun} now={clock} />
                </p>
              </>
            )}
          </div>
        </>
      )}
      {!phone && error}
      {!phone && actions}
    </section>
  );
}

// ─── the first run: one blob in the spotlight, places waiting either side ──

function FirstRun({
  hostLabel,
  onCreate,
  onCreateFrom,
  windowFocused,
}: {
  hostLabel: string;
  onCreate: () => void;
  onCreateFrom: (job: string) => void;
  windowFocused: boolean;
}): React.ReactElement {
  const place = (shape: "mochi" | "drop" | "star" | "ghost", far: boolean): React.ReactElement => (
    <span
      className={`cast-slot is-place${far ? " is-far" : ""}`}
      style={vars({ "--foot": `${castFoot(shape)}%` })}
    >
      <span className="cast-figure">
        <BlobOutline shape={shape} size={84} />
      </span>
    </span>
  );
  return (
    <div className="cast-first">
      <div className="cast-stage" aria-hidden="true">
        <div className="cast-shelf" />
        {place("mochi", true)}
        {place("drop", false)}
        <span className="cast-slot is-hero" style={vars({ "--foot": `${castFoot("orb")}%` })}>
          <span className="cast-bubble">{`Give me a job, and I’ll do it on ${hostLabel}.`}</span>
          <span className="cast-figure">
            <BlobAvatar
              look={{ shape: "orb", face: "happy", color: "sky" }}
              size={112}
              className="cast-bob"
            />
          </span>
        </span>
        {place("star", false)}
        {place("ghost", true)}
      </div>
      <section className="cast-welcome">
        <h2>No specialists yet</h2>
        <p>
          A specialist does one job for you on your host, on a schedule or when you ask, and shares
          Kleio’s memory of you.
        </p>
        <MetalButton
          windowFocused={windowFocused}
          className="btn btn-primary cast-btn-lg"
          onClick={onCreate}
        >
          + Create your first specialist
        </MetalButton>
        <div className="cast-examples" role="group" aria-label="Example jobs">
          <span className="cast-ex-label">Or start from</span>
          {JOB_EXAMPLES.map((x, i) => (
            <button
              key={x.label}
              type="button"
              className="cast-example"
              title={x.job}
              onClick={() => onCreateFrom(x.job)}
            >
              <BlobOutline shape={EXAMPLE_SHAPES[i] ?? "orb"} size={18} />
              {x.label}
            </button>
          ))}
        </div>
        <p className="cast-tip">
          Open Specialists from anywhere with <kbd>⌘⇧L</kbd>
        </p>
      </section>
    </div>
  );
}

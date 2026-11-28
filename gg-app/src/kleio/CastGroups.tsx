// Groups, as the cast draws them: each group is its first
// members standing together on the lit shelf. Clicking one puts it in the
// spotlight and shows its profile underneath (what was last said, who is in
// it), which opens its room or its form. No mockup draws this page: it is put
// together from the Specialists shelf's parts (CastList.tsx, kleio-cast.css).

import { useEffect, useMemo, useState } from "react";
import { PencilSimpleIcon } from "@phosphor-icons/react";
import { MetalButton } from "../MetalButton";
import { ListSkeleton } from "../Skeleton";
import { useWindowFocused } from "../useWindowFocused";
import { AgentAvatar, BlobOutline, GroupAvatar } from "./BlobAvatar";
import { formatWhen, plainSummary } from "./blobFormat";
import { lookOf, type BlobShape } from "./blobLook";
import { castFoot, castLayout, SHELVES_SHOWN, type CastLayout } from "./castLayout";
import { groupRowState, groupRowSub } from "./groupParts";
import { AppsButton, KleioHead } from "./KleioChrome";
import type { Blob, Group } from "./kleioApi";
import { groupMembers, plural } from "./useGroupChat";
import "./kleio-cast.css";

/** How often "2 h ago" is read again. */
const CLOCK_MS = 30_000;
/** A group stands as its first members, as its picture does (GroupAvatar). */
const HUDDLE = 3;
/** Specialists on the stage before there is a group. */
const STAGE = 5;
/** The stage's waiting places before there is a specialist, outermost first and last. */
const PLACES: readonly BlobShape[] = ["mochi", "drop", "orb", "star", "ghost"];

const vars = (v: Record<string, string | number>): React.CSSProperties => v as React.CSSProperties;
const foot = (b: Pick<Blob, "id" | "color" | "shape" | "face">): React.CSSProperties =>
  vars({ "--foot": `${castFoot(lookOf(b).shape)}%` });

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

/** One group on the shelf. */
interface Troupe {
  group: Group;
  /** Its members that still exist, in member order. */
  members: Blob[];
  replying: boolean;
  /** Under its name: replying, when it last spoke, or how many are in it. */
  state: string;
  /** Its shelf, counted from the back. */
  row: number;
  /** Its place along the widest shelf; halves where a short shelf is centred. */
  col: number;
  /** On the front shelf, the one the profile's pointer can reach. */
  front: boolean;
}

/** Every group on the shelves, in the host's order, as the cast is laid out. */
function troupesOf(
  groups: readonly Group[],
  byId: ReadonlyMap<string, Blob>,
  now: Date,
): { layout: CastLayout; troupes: Troupe[] } {
  const layout = castLayout(groups.length);
  const troupes: Troupe[] = [];
  let index = 0;
  layout.rows.forEach((size, row) => {
    const offset = layout.tier === "solo" ? 0 : (layout.cols - size) / 2;
    for (let place = 0; place < size; place++) {
      const group = groups[index++];
      if (!group) continue;
      troupes.push({
        group,
        members: groupMembers(group, byId),
        replying: group.typing.length > 0,
        state: groupRowState(group, now.getTime()).text,
        row,
        col: place + offset,
        front: row === layout.rows.length - 1,
      });
    }
  });
  return { layout, troupes };
}

export function CastGroups({
  groups,
  blobs,
  error,
  onClose,
  onCreate,
  onOpen,
  onEdit,
  onOpenApps,
  now,
}: {
  groups: Group[] | null;
  blobs: Blob[];
  error: string | null;
  onClose: () => void;
  onCreate: () => void;
  /** Open this group's room. */
  onOpen: (id: string) => void;
  onEdit: (id: string) => void;
  onOpenApps?: () => void;
  /** Hold the clock still (tests). */
  now?: Date;
}): React.ReactElement {
  const [picked, setPicked] = useState<string | null>(null);
  const windowFocused = useWindowFocused();
  const clock = useClock(now, CLOCK_MS);
  const byId = useMemo(() => new Map(blobs.map((b) => [b.id, b])), [blobs]);

  const all = groups ?? [];
  const some = all.length > 0;
  const noAgents = groups !== null && blobs.length === 0;
  const loading = groups === null && !error;
  const { layout, troupes } = troupesOf(all, byId, clock);
  // The spotlight starts on a group that is replying.
  const selected =
    troupes.find((t) => t.group.id === picked) ??
    troupes.find((t) => t.replying) ??
    troupes[0] ??
    null;
  const replying = troupes.filter((t) => t.replying).length;
  // A lone group keeps a place beside it, where the next one will stand.
  const place = layout.tier === "solo" && !noAgents;
  const cols = layout.tier === "solo" && !place ? 1 : layout.cols;
  // With no group yet and someone to put in one, the page's own button offers it.
  const welcome = groups !== null && !some && !noAgents;

  return (
    <>
      <KleioHead
        onBack={onClose}
        title="Groups"
        status={
          some && (
            <span className="cast-pills">
              <span className="cast-pill">{all.length}</span>
              {replying > 0 && (
                <span className="cast-pill is-live">
                  <span className="cast-dot" aria-hidden="true" />
                  {replying}
                  <span className="cast-pill-word"> replying</span>
                </span>
              )}
            </span>
          )
        }
        phoneMenu={[
          ...(onOpenApps ? [{ label: "Connect apps", onSelect: onOpenApps }] : []),
          ...(!welcome ? [{ label: "New group", onSelect: onCreate, disabled: noAgents }] : []),
        ]}
        actions={
          <>
            {onOpenApps && <AppsButton onClick={onOpenApps} />}
            {!welcome && (
              <MetalButton
                windowFocused={windowFocused}
                className="btn btn-primary btn-sm"
                disabled={noAgents}
                title={noAgents ? "Create a specialist first" : undefined}
                onClick={onCreate}
              >
                + New group
              </MetalButton>
            )}
          </>
        }
      />

      <div className="cast-page" data-tier={layout.tier} style={vars({ "--cols": cols })}>
        {loading && <ListSkeleton rows={3} />}
        {error && (
          <p className="kleio-error cast-error" role="alert">
            {error}
          </p>
        )}
        {groups !== null && !some && (
          <FirstGroup blobs={blobs} onCreate={onCreate} windowFocused={windowFocused} />
        )}
        {selected && (
          <>
            <div
              className="cast"
              role="group"
              aria-label={`Your ${plural(all.length, "group")}`}
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
                  {troupes
                    .filter((t) => t.row === row)
                    .map((t) => (
                      <TroupeActor
                        key={t.group.id}
                        troupe={t}
                        selected={t === selected}
                        onSelect={() => setPicked(t.group.id)}
                      />
                    ))}
                  {place && (
                    <button type="button" className="cast-actor is-add" onClick={onCreate}>
                      <span className="cast-figure">
                        <BlobOutline shape="orb" size={124} />
                      </span>
                      <span className="cast-name">New group</span>
                      <span className="cast-state">Pick its members</span>
                    </button>
                  )}
                </div>
              ))}
            </div>
            {layout.hidden > 0 && (
              <p className="cast-more">{`${layout.hidden} more below · scroll`}</p>
            )}
            <GroupProfile
              troupe={selected}
              // Three shelves' profile shrinks every blob in its head; a group's picture is three.
              avatar={layout.tier === "two"}
              clock={clock}
              windowFocused={windowFocused}
              onOpen={() => onOpen(selected.group.id)}
              onEdit={() => onEdit(selected.group.id)}
            />
          </>
        )}
      </div>
    </>
  );
}

// ─── one group on the shelf: its first members, standing together ─────────

function TroupeActor({
  troupe,
  selected,
  onSelect,
}: {
  troupe: Troupe;
  selected: boolean;
  onSelect: () => void;
}): React.ReactElement {
  const { group, members, replying, state } = troupe;
  const shown = members.slice(0, HUDDLE);
  return (
    <button
      type="button"
      className={`cast-actor cast-troupe${replying ? " is-working" : ""}`}
      data-n={shown.length}
      aria-pressed={selected}
      aria-label={`${group.name}. ${state}. ${groupRowSub(group)}`}
      onClick={onSelect}
    >
      {replying && (
        <span className="cast-bubble is-typing" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
      )}
      <span className="cast-figure">
        {shown.length === 0 ? (
          // Everyone in it has been deleted: an empty place.
          <BlobOutline shape="orb" size={84} />
        ) : (
          <span className="cast-huddle">
            {shown.map((b) => (
              <span key={b.id} className="cast-h" style={foot(b)}>
                <AgentAvatar agent={b} size={84} live={group.typing.includes(b.id)} />
              </span>
            ))}
          </span>
        )}
      </span>
      <span className="cast-name">{group.name}</span>
      <span className="cast-state">{state}</span>
    </button>
  );
}

// ─── the selected group's profile, under the shelves ──────────────────────

function GroupProfile({
  troupe,
  avatar,
  clock,
  windowFocused,
  onOpen,
  onEdit,
}: {
  troupe: Troupe;
  avatar: boolean;
  clock: Date;
  windowFocused: boolean;
  onOpen: () => void;
  onEdit: () => void;
}): React.ReactElement {
  const { group, members, replying } = troupe;
  const last = group.lastMessage;
  const author = last ? members.find((b) => b.id === last.author) : undefined;
  const typing = members.filter((b) => group.typing.includes(b.id));
  const gone = group.members.length - members.length;
  return (
    <section
      className="cast-profile is-group"
      aria-label={group.name}
      style={vars({ "--col": troupe.col, "--notch": troupe.front ? 1 : 0 })}
    >
      <div className="cast-p-id">
        <div className="cast-p-head">
          {avatar && <GroupAvatar members={members} color={group.color} size={36} />}
          <h2>{group.name}</h2>
        </div>
        <p className="cast-p-state">
          {replying ? (
            <span className="cast-pill is-live">
              <span className="cast-dot" aria-hidden="true" />
              Replying…
            </span>
          ) : (
            <span className="cast-pill">{plural(group.members.length, "member")}</span>
          )}
          {typing.length > 0 && <span>{typing.map((b) => b.name).join(", ")}</span>}
        </p>
      </div>

      <div className="cast-p-col">
        <h3 className="cast-label">Latest message</h3>
        {last ? (
          <>
            <p className="cast-g-who">
              {author && <AgentAvatar agent={author} size={20} />}
              <span>{last.authorName}</span>
              <time dateTime={last.at}>{formatWhen(last.at, clock)}</time>
            </p>
            <p className="cast-g-text">{plainSummary(last.text)}</p>
          </>
        ) : (
          <p className="cast-p-note">No messages yet — say hello.</p>
        )}
      </div>

      <div className="cast-p-col">
        <h3 className="cast-label">Members</h3>
        {members.length > 0 && (
          <ul className="cast-g-members">
            {members.map((b) => (
              <li key={b.id} className={group.typing.includes(b.id) ? "is-live" : undefined}>
                <AgentAvatar agent={b} size={20} />
                <span>{b.name}</span>
              </li>
            ))}
          </ul>
        )}
        {gone > 0 && (
          <p className="cast-p-note">
            {plural(gone, "deleted specialist")} — edit the group to remove.
          </p>
        )}
      </div>

      <div className="cast-p-actions">
        <MetalButton
          windowFocused={windowFocused}
          className="btn btn-primary btn-sm"
          onClick={onOpen}
        >
          Open chat
        </MetalButton>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onEdit}>
          <PencilSimpleIcon size={14} weight="bold" aria-hidden="true" />
          Edit
        </button>
      </div>
    </section>
  );
}

// ─── no groups yet: your specialists on the stage, or places waiting for them ──

function FirstGroup({
  blobs,
  onCreate,
  windowFocused,
}: {
  blobs: readonly Blob[];
  onCreate: () => void;
  windowFocused: boolean;
}): React.ReactElement {
  const cast = blobs.slice(0, STAGE);
  return (
    <div className="cast-first is-group">
      <div
        className="cast-stage"
        aria-hidden="true"
        style={vars({ "--n": cast.length || PLACES.length })}
      >
        <div className="cast-shelf" />
        {cast.length > 0
          ? cast.map((b) => (
              <span key={b.id} className="cast-slot" style={foot(b)}>
                <span className="cast-figure">
                  <AgentAvatar agent={b} size={84} />
                </span>
              </span>
            ))
          : PLACES.map((shape, i) => (
              <span
                key={shape}
                className={`cast-slot is-place${i === 0 || i === PLACES.length - 1 ? " is-far" : ""}`}
                style={vars({ "--foot": `${castFoot(shape)}%` })}
              >
                <span className="cast-figure">
                  <BlobOutline shape={shape} size={84} />
                </span>
              </span>
            ))}
      </div>
      <section className="cast-welcome">
        <h2>No groups yet</h2>
        <p>
          {cast.length > 0
            ? "A group chat brings several specialists together. Everyone replies, or @mention one to ask just them."
            : "A group chat brings several specialists together. Create a specialist first, then add it to a group."}
        </p>
        {cast.length > 0 && (
          <MetalButton
            windowFocused={windowFocused}
            className="btn btn-primary cast-btn-lg"
            onClick={onCreate}
          >
            + New group
          </MetalButton>
        )}
      </section>
    </div>
  );
}

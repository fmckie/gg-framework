// A group's chat on the desktop, in the Cast's look: who is in the room on one
// shelf (the one replying in the spotlight, the turn arcing over to it), the
// conversation underneath, and the files they shared in a panel on the right.
// It reads and sends exactly what today's chat does (useGroupChat); the iPhone
// keeps that chat (GroupsPage.tsx).

import { useEffect, useId, useMemo } from "react";
import {
  ArrowUpIcon,
  GlobeIcon,
  PencilSimpleIcon,
  SidebarSimpleIcon,
  SquareIcon,
  WarningCircleIcon,
} from "@phosphor-icons/react";
import { ConfirmModal } from "../ConfirmModal";
import { DictateButton, DictationStatus } from "../DictateButton";
import { LinkHandlerProvider, Markdown } from "../Markdown";
import { useAssetOpen, type Asset } from "./AssetsPanel";
import { AgentAvatar, GroupAvatar } from "./BlobAvatar";
import { formatClock } from "./blobFormat";
import { roomOf, type Room, type RoomMember } from "./castLayout";
import { ChatAsk } from "./ChatAsk";
import { FileCards, KindIcon } from "./FileCard";
import { KleioHead, NewChatButton, useSidebar } from "./KleioChrome";
import { fileLinks, fileOwner, ownerKey } from "./kleioFiles";
import type { Blob, Group } from "./kleioApi";
import { LIVE_TOOL_ROWS, ToolCallRow } from "./LiveToolFeed";
import { MESSAGE_MAX, plural, useGroupChat } from "./useGroupChat";
import "./kleio-cast.css";

const vars = (v: Record<string, string | number>): React.CSSProperties => v as React.CSSProperties;

/** The file kinds whose tile is drawn as a sheet of cells. */
const SHEETS: readonly string[] = ["XLSX", "XLS", "CSV", "TSV", "NUMBERS", "ODS"];

const ARC = "M10 56 C 60 -10, 160 -10, 210 56";
const LONG_ARC = "M0 58 C 46 -14, 174 -14, 220 58";

export function CastRoom({
  group,
  blobs,
  onBack,
  onEdit,
}: {
  group: Group;
  blobs: Blob[];
  onBack: () => void;
  onEdit: () => void;
}): React.ReactElement {
  const {
    messages,
    typing,
    outcomes,
    asks,
    members,
    byId,
    busy,
    draft,
    error,
    assets,
    activity,
    answerAsk,
    confirmNew,
    dictation,
    followHandlers,
    inputRef,
    linkHandler,
    loaded,
    logRef,
    mention,
    polledAt,
    send,
    sending,
    setConfirmNew,
    setDraft,
    setError,
    showDictation,
    startFresh,
    starting,
    stop,
    stopping,
  } = useGroupChat(group, blobs);
  const sidebar = useSidebar();
  const sideId = useId();
  const room = useMemo(
    () => roomOf(members, { typing, outcomes, messages }),
    [members, typing, outcomes, messages],
  );
  const gone = group.members.length - members.length;
  const drawer = sidebar.narrow && sidebar.open;
  const closeDrawer = sidebar.close;

  // In a narrow window the panel lies over the room: Escape puts it away.
  useEffect(() => {
    if (!drawer) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") closeDrawer();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [drawer, closeDrawer]);

  return (
    <div className="cast-room">
      <KleioHead
        onBack={onBack}
        leading={<GroupAvatar members={members} color={group.color} size={24} />}
        title={group.name}
        subtitle={
          busy ? (
            <span className="cast-pill is-live">
              <span className="cast-dot" aria-hidden="true" />
              Replying…
            </span>
          ) : (
            <span className="cast-pill">{plural(group.members.length, "member")}</span>
          )
        }
        actions={
          <>
            <NewChatButton onClick={() => setConfirmNew(true)} disabled={starting} />
            <button
              type="button"
              className="btn btn-ghost btn-sm btn-nav-icon kleio-icon-btn cast-side-btn"
              title="Assets"
              aria-label="Assets"
              aria-pressed={sidebar.open}
              aria-controls={sideId}
              onClick={sidebar.toggle}
            >
              <SidebarSimpleIcon size={16} weight="bold" aria-hidden="true" />
            </button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={onEdit}>
              <PencilSimpleIcon size={14} weight="bold" aria-hidden="true" />
              Edit
            </button>
          </>
        }
      />
      <div
        className={`cast-room-body${sidebar.open ? " has-side" : ""}${sidebar.narrow ? " is-narrow" : ""}`}
      >
        <div className="cast-room-main">
          <Stage room={room} onMention={mention} />
          {gone > 0 && (
            <p className="cast-room-note">
              {plural(gone, "deleted specialist")} — edit the group to remove.
            </p>
          )}

          <div
            ref={logRef}
            className="cast-thread"
            role="log"
            aria-live="polite"
            aria-label={`${group.name} conversation`}
            tabIndex={0}
            {...followHandlers}
          >
            <div className="cast-thread-inner">
              {!loaded && !error && <p className="kleio-chat-hint">Opening…</p>}
              {loaded && messages.length === 0 && (
                <div className="kleio-chat-intro">
                  <GroupAvatar members={members} color={group.color} size={80} />
                  <p className="kleio-chat-hint">
                    Say hello. The best-placed specialist starts, or @mention who you want, in
                    order.
                  </p>
                </div>
              )}
              {messages.map((m) => {
                if (m.author === "you")
                  return (
                    <div key={m.id} className="cast-msg is-you">
                      <p className="cast-bub">{m.text}</p>
                      <time dateTime={m.at}>{formatClock(m.at)}</time>
                    </div>
                  );
                const b = byId.get(m.author);
                const owner = fileOwner(m.author, group.id);
                return (
                  <div key={m.id} className="cast-msg">
                    {b ? (
                      <AgentAvatar agent={b} size={30} />
                    ) : (
                      <span className="kleio-member-gone" aria-hidden="true" />
                    )}
                    <div className="cast-msg-body">
                      <p className="cast-msg-who">
                        {m.authorName}
                        <time dateTime={m.at}>{formatClock(m.at)}</time>
                      </p>
                      <div className="cast-bub assistant-text">
                        <LinkHandlerProvider value={linkHandler(m.author)}>
                          <Markdown>{m.text}</Markdown>
                        </LinkHandlerProvider>
                      </div>
                      <FileCards owner={owner} links={fileLinks(m.text, owner)} />
                    </div>
                  </div>
                );
              })}
              {Object.entries(asks).map(([bid, prompt]) => (
                <ChatAsk
                  key={prompt.id}
                  prompt={prompt}
                  who={byId.get(bid)?.name ?? "A specialist"}
                  onSend={(answers) => answerAsk(bid, prompt, answers)}
                  onTypeInstead={(seed) => {
                    if (seed) setDraft((d) => d + seed);
                    inputRef.current?.focus();
                  }}
                />
              ))}
              {/* One waiting on your answer has its question above instead. */}
              {typing
                .filter((id) => !asks[id])
                .map((id) => {
                  const b = byId.get(id);
                  const name = b?.name ?? "Someone";
                  const calls = (activity[id] ?? []).slice(-LIVE_TOOL_ROWS);
                  return (
                    <div key={id} className="cast-msg is-replying" role="status">
                      {b ? (
                        <AgentAvatar agent={b} size={30} live />
                      ) : (
                        <span className="kleio-member-gone" aria-hidden="true" />
                      )}
                      <div className="cast-msg-body">
                        <p className="cast-msg-who">
                          {name} <span className="cast-live-word">is replying</span>
                        </p>
                        {calls.length > 0 && (
                          <ol
                            className="cast-tools cast-steps"
                            aria-label={`What ${name} is doing`}
                          >
                            {calls.map((e) => (
                              <ToolCallRow key={e.id} as="li" entry={e} nowMs={polledAt} />
                            ))}
                          </ol>
                        )}
                      </div>
                    </div>
                  );
                })}
            </div>
          </div>

          <form
            className="cast-composer"
            onSubmit={(e) => {
              e.preventDefault();
              void send();
            }}
          >
            {error && (
              <p className="kleio-error" role="alert">
                {error}
              </p>
            )}
            {members.length > 1 && (
              <div
                className={`cast-mentions${room.crowd ? " is-crowd" : ""}`}
                role="group"
                aria-label="Mention a member"
              >
                {members.map((m) => (
                  <button key={m.id} type="button" onClick={() => mention(m.name)}>
                    <AgentAvatar agent={m} size={18} />@{m.name}
                  </button>
                ))}
              </div>
            )}
            <div className="cast-input">
              <textarea
                ref={inputRef}
                rows={1}
                value={draft}
                maxLength={MESSAGE_MAX}
                placeholder={`Message ${group.name}`}
                aria-label={`Message ${group.name}`}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                    e.preventDefault();
                    void send();
                  }
                }}
              />
              {showDictation && <DictateButton dictation={dictation} />}
              {busy || sending ? (
                <button
                  type="button"
                  className="cast-send"
                  title="Stop"
                  aria-label="Stop"
                  disabled={stopping}
                  onClick={() => void stop()}
                >
                  <SquareIcon size={12} weight="fill" aria-hidden="true" />
                </button>
              ) : (
                <button
                  type="submit"
                  className="cast-send"
                  title="Send"
                  aria-label="Send"
                  disabled={!draft.trim()}
                >
                  <ArrowUpIcon size={16} weight="bold" aria-hidden="true" />
                </button>
              )}
              {showDictation && <DictationStatus dictation={dictation} />}
            </div>
          </form>
        </div>

        {drawer && (
          <button
            type="button"
            className="cast-room-scrim"
            aria-label="Hide assets"
            tabIndex={-1}
            onClick={closeDrawer}
          />
        )}
        <aside
          id={sideId}
          className="cast-room-side"
          aria-label={`${group.name} assets`}
          hidden={!sidebar.open}
        >
          <div className="cast-side-head">
            <h2 className="cast-label">
              Assets
              {assets.length > 0 && <span className="cast-count">{assets.length}</span>}
            </h2>
            {assets.length > 0 && <span className="cast-hint">Newest first</span>}
          </div>
          {assets.length === 0 ? (
            <p className="cast-p-note">Files your specialists share will appear here.</p>
          ) : (
            <ul className="cast-tiles" aria-label="Files shared in this conversation, newest first">
              {assets.map((a) => (
                <Tile
                  key={`${ownerKey(a.owner)}\u0000${a.path}`}
                  asset={a}
                  maker={a.owner.kind === "group" ? byId.get(a.owner.blobId) : undefined}
                  onError={setError}
                />
              ))}
            </ul>
          )}
        </aside>
      </div>
      {confirmNew && (
        <ConfirmModal
          title="Start a new conversation?"
          message={`Every device switches to a fresh conversation with ${group.name}, and any reply in progress stops. The old one stays on your host.`}
          confirmLabel="New conversation"
          busy={starting}
          onConfirm={() => void startFresh()}
          onClose={() => setConfirmNew(false)}
        />
      )}
    </div>
  );
}

// ─── who is in the room ───────────────────────────────────────────────────

function Stage({
  room,
  onMention,
}: {
  room: Room;
  onMention: (name: string) => void;
}): React.ReactElement {
  return (
    <div
      className={`cast-room-stage${room.crowd ? " is-crowd" : ""}`}
      role="group"
      aria-label="Members"
      style={vars({ "--n": Math.max(1, room.members.length) })}
    >
      <div className="cast-shelf" aria-hidden="true" />
      <div className="cast-room-members">
        {room.handoff && <Baton {...room.handoff} long={room.crowd} />}
        {room.members.map((m) => (
          <Member key={m.blob.id} member={m} onMention={onMention} />
        ))}
      </div>
    </div>
  );
}

/** The turn passing from one member to the next: an arc between their places,
 *  with a light travelling the way it went. */
function Baton({
  from,
  to,
  long,
}: {
  from: number;
  to: number;
  long: boolean;
}): React.ReactElement {
  const gradient = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const place = {
    style: vars({ "--b-lo": Math.min(from, to), "--b-span": Math.abs(to - from) }),
    // Drawn left to right; a turn handed back along the shelf is mirrored.
    ...(to < from ? { "data-back": "" } : {}),
    "aria-hidden": true,
  };
  if (!long)
    return (
      <svg className="cast-baton" viewBox="0 0 220 60" preserveAspectRatio="none" {...place}>
        <path className="cast-baton-arc" d={ARC} />
        <path className="cast-baton-spark" d={ARC} />
      </svg>
    );
  return (
    <div className="cast-baton is-long" {...place}>
      <svg viewBox="0 0 220 60" preserveAspectRatio="none">
        <defs>
          <linearGradient id={gradient} x1="0" x2="1" y1="0" y2="0">
            <stop offset="0" stopColor="#fff" stopOpacity={0.22} />
            <stop offset="0.6" stopColor="#fff" stopOpacity={0.28} />
            <stop offset="1" style={{ stopColor: "var(--primary-hi)" }} stopOpacity={0.9} />
          </linearGradient>
        </defs>
        <path className="cast-baton-track" d={LONG_ARC} stroke={`url(#${gradient})`} />
      </svg>
      <svg className="cast-baton-sweep" viewBox="0 0 220 60" preserveAspectRatio="none">
        <path className="cast-baton-glow" d={LONG_ARC} />
      </svg>
    </div>
  );
}

function Member({
  member,
  onMention,
}: {
  member: RoomMember;
  onMention: (name: string) => void;
}): React.ReactElement {
  const { blob, tone, state, reason } = member;
  const said = reason ? `${state}: ${reason}` : state;
  return (
    <button
      type="button"
      className={`cast-actor cast-member is-${tone}${member.from ? " is-from" : ""}`}
      aria-label={[`Mention ${blob.name}`, said].filter(Boolean).join(". ")}
      title={`Mention ${blob.name}`}
      onClick={() => onMention(blob.name)}
      style={vars({ "--foot": `${member.foot}%` })}
      {...(member.clock ? { "data-clock": member.clock } : {})}
    >
      {tone === "live" && (
        <span className="cast-bubble is-typing" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
      )}
      {tone === "failed" && reason && (
        <span className="cast-bubble" title={reason}>
          <WarningCircleIcon size={13} weight="bold" aria-hidden="true" />
          <span className="cast-btxt">{reason}</span>
        </span>
      )}
      <span className="cast-figure">
        <AgentAvatar
          agent={blob}
          size={48}
          live={tone === "live"}
          animated={Boolean(member.clock)}
        />
      </span>
      <span className="cast-name">{blob.name}</span>
      <span className="cast-state">{state}</span>
    </button>
  );
}

// ─── what they shared ─────────────────────────────────────────────────────

function Tile({
  asset,
  maker,
  onError,
}: {
  asset: Asset;
  /** Who shared it, for its face beside the name. */
  maker: Blob | undefined;
  onError: (message: string) => void;
}): React.ReactElement {
  const { opening, open, site, name, kind } = useAssetOpen(asset, onError);
  return (
    <li>
      <button
        type="button"
        onClick={() => void open()}
        disabled={opening}
        title={asset.path}
        aria-label={`Open ${asset.label}, shared by ${asset.by}`}
      >
        <span className={`cast-t-kind${SHEETS.includes(kind) ? " is-sheet" : ""}`}>
          {site ? (
            <GlobeIcon size={26} weight="light" aria-hidden="true" />
          ) : (
            <KindIcon name={name} size={26} />
          )}
          <em>{kind}</em>
        </span>
        <span className="cast-t-name">{asset.label}</span>
        <span className="cast-t-by">
          {maker && <AgentAvatar agent={maker} size={14} />}
          {opening ? "Opening…" : asset.by}
        </span>
      </button>
    </li>
  );
}

// Groups: a group chat with several specialists at once, from the Kleio host. A
// list laid out like Chats and Code; a group opens into its chat, and new/edit
// are full-page forms. On the desktop the list is the Cast's shelf
// (CastGroups.tsx), the form its two columns (CastGroupForm.tsx) and the chat
// its room (CastRoom.tsx); the iPhone keeps the rows, the panels and a chat
// with a sidebar of its members (collapsible from the header).
// A group's picture is its members' blobs.

import { useCallback, useEffect, useId, useMemo, useState } from "react";
import {
  ArrowUpIcon,
  CaretRightIcon,
  CheckIcon,
  PencilSimpleIcon,
  SquareIcon,
  TrashIcon,
} from "@phosphor-icons/react";
import { ActionMetal } from "../ActionMetal";
import { Badge } from "../Badge";
import { ConfirmModal } from "../ConfirmModal";
import { DictateButton, DictationStatus } from "../DictateButton";
import { LinkHandlerProvider, Markdown } from "../Markdown";
import { MetalButton } from "../MetalButton";
import { isPhone } from "../platform";
import { ListSkeleton } from "../Skeleton";
import { theme } from "../theme";
import { useWindowFocused } from "../useWindowFocused";
import { WorkingBeam } from "../WorkingBeam";
import { AgentRowContent, type RowState } from "./AgentRow";
import { AgentAvatar, BlobAvatar, GroupAvatar } from "./BlobAvatar";
import { BLOB_COLOR_LABEL, BLOB_TONES } from "./blobLook";
import { CastGroupForm } from "./CastGroupForm";
import { CastGroups } from "./CastGroups";
import { CastRoom } from "./CastRoom";
import { ChatAsk } from "./ChatAsk";
import { FileCards } from "./FileCard";
import { AssetsPanel } from "./AssetsPanel";
import {
  AppsButton,
  KleioHead,
  KleioPanel,
  KleioSplit,
  NewChatButton,
  SideToggle,
  useSidebar,
} from "./KleioChrome";
import { fileLinks, fileOwner } from "./kleioFiles";
import { LiveToolFeed, ToolCallRow } from "./LiveToolFeed";
import {
  listBlobs,
  listGroups,
  errorText,
  type Blob,
  type Group,
  type ToolActivityEntry,
  type GroupTurnOutcome,
} from "./kleioApi";
import { OUTCOME_LABEL, outcomeTone } from "./groupOutcome";
import {
  GROUP_NAME_MAX,
  groupRowState,
  groupRowSub,
  HOW_IT_WORKS,
  MAX_MEMBERS,
  useGroupForm,
  type GroupFormProps,
} from "./groupParts";
import { groupMembers, MESSAGE_MAX, plural, useGroupChat } from "./useGroupChat";

const LIST_REFRESH_MS = 10_000;

function HowItWorks(): React.ReactElement {
  return (
    <ul className="kleio-howto">
      {HOW_IT_WORKS.map((line) => (
        <li key={line}>{line}</li>
      ))}
    </ul>
  );
}

function ErrorLine({ error }: { error: string | null }): React.ReactElement | null {
  return error ? (
    <p className="kleio-error" role="alert">
      {error}
    </p>
  ) : null;
}

type View =
  | { kind: "list" }
  | { kind: "chat"; id: string }
  // `from`: where Cancel goes back to. The desktop's list can open the form itself.
  | { kind: "form"; id: string | null; from?: "list" };

/**
 * A member's tool calls for its current or last turn, oldest first, and how
 * that turn ended — a disclosure under its row in the Members panel.
 */
function MemberActivity({
  name,
  entries,
  outcome,
  replying,
  nowMs,
  open,
  onToggle,
}: {
  name: string;
  entries: readonly ToolActivityEntry[];
  outcome: GroupTurnOutcome | null;
  replying: boolean;
  /** When the host was last polled: how long running calls have taken so far. */
  nowMs: number;
  open: boolean;
  onToggle: () => void;
}): React.ReactElement | null {
  const bodyId = useId();
  if (!replying && entries.length === 0 && !outcome) return null;
  // A newer host may send a kind this build doesn't know.
  const label = outcome ? (OUTCOME_LABEL[outcome.kind] ?? "Ended") : null;
  const tone = outcome ? outcomeTone(outcome.kind) : "";
  const meta = [
    entries.length ? plural(entries.length, "tool call") : null,
    replying ? "live" : label,
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <div className="kleio-activity">
      <button
        type="button"
        className="kleio-activity-toggle"
        aria-expanded={open}
        aria-controls={bodyId}
        // Starts with the visible text; says whose it is and its state.
        aria-label={`Activity of ${name}${meta ? `, ${meta}` : ""}`}
        onClick={onToggle}
      >
        <CaretRightIcon
          className="kleio-activity-caret"
          size={10}
          weight="bold"
          aria-hidden="true"
        />
        Activity
        {meta && (
          <span className={`kleio-activity-meta${replying ? " is-live" : tone}`}>{meta}</span>
        )}
      </button>
      <div id={bodyId} className="kleio-activity-body" hidden={!open}>
        {entries.length > 0 ? (
          <ol className="kleio-activity-list" aria-label={`${name}'s tool calls, oldest first`}>
            {entries.map((e) => (
              <ToolCallRow key={e.id} as="li" entry={e} nowMs={nowMs} />
            ))}
          </ol>
        ) : (
          replying && <p className="kleio-activity-note">No tool calls yet.</p>
        )}
        {outcome && label && (
          <p className={`kleio-activity-note${tone}`}>
            {outcome.reason ? `${label}: ${outcome.reason}` : label}
          </p>
        )}
      </div>
    </div>
  );
}

export function GroupsPage({
  onClose,
  onListChange,
  onOpenApps,
  openId,
}: {
  /** Leave Groups (Back on the list). */
  onClose: () => void;
  /** Told whether the list is showing, so the screen can show its switcher. */
  onListChange?: (atList: boolean) => void;
  /** Open the Apps page (a "Connect apps" button on the list). */
  onOpenApps?: () => void;
  /** Open straight into this group's chat (a tapped notification). */
  openId?: string;
}): React.ReactElement {
  const [groups, setGroups] = useState<Group[] | null>(null);
  const [blobs, setBlobs] = useState<Blob[]>([]);
  const [view, setView] = useState<View>(openId ? { kind: "chat", id: openId } : { kind: "list" });
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [g, b] = await Promise.all([listGroups(), listBlobs()]);
      setGroups(g);
      setBlobs(b);
      setError(null);
    } catch (e) {
      setError(errorText(e));
    }
  }, []);
  useEffect(() => {
    void load();
    const id = window.setInterval(() => void load(), LIST_REFRESH_MS);
    return () => window.clearInterval(id);
  }, [load]);

  useEffect(() => {
    onListChange?.(view.kind === "list");
  }, [view.kind, onListChange]);

  const toList = (): void => {
    setView({ kind: "list" });
    void load();
  };

  if (view.kind === "form") {
    const group = view.id ? groups?.find((g) => g.id === view.id) : undefined;
    const fromList = view.from === "list";
    // The desktop draws the Cast's form; the iPhone keeps today's panels.
    const Form = isPhone() ? GroupForm : CastGroupForm;
    return (
      <Form
        {...(group ? { group } : {})}
        blobs={blobs}
        onCancel={() =>
          setView(group && !fromList ? { kind: "chat", id: group.id } : { kind: "list" })
        }
        onSaved={(g) => {
          setView({ kind: "chat", id: g.id });
          void load();
        }}
        onDeleted={toList}
      />
    );
  }

  if (view.kind === "chat") {
    const group = groups?.find((g) => g.id === view.id);
    if (group) {
      // The desktop draws the Cast's room; the iPhone keeps today's chat.
      const Chat = isPhone() ? GroupChat : CastRoom;
      return (
        <Chat
          group={group}
          blobs={blobs}
          onBack={toList}
          onEdit={() => setView({ kind: "form", id: group.id })}
        />
      );
    }
    if (groups === null)
      return (
        <>
          <KleioHead onBack={toList} title="Groups" />
          <div className="picker-empty" style={{ color: theme.textMuted }}>
            Loading…
          </div>
        </>
      );
  }

  const list = {
    groups,
    blobs,
    error,
    onClose,
    onCreate: () => setView({ kind: "form", id: null }),
    onOpen: (id: string) => setView({ kind: "chat", id }),
    ...(onOpenApps ? { onOpenApps } : {}),
  };
  // The iPhone keeps the list of rows; the desktop stands each group on the shelf.
  return isPhone() ? (
    <GroupList {...list} />
  ) : (
    <CastGroups {...list} onEdit={(id) => setView({ kind: "form", id, from: "list" })} />
  );
}

// ─── the list ─────────────────────────────────────────────────────────────────────────

function GroupList({
  groups,
  blobs,
  error,
  onClose,
  onCreate,
  onOpen,
  onOpenApps,
}: {
  groups: Group[] | null;
  blobs: Blob[];
  error: string | null;
  onClose: () => void;
  onCreate: () => void;
  onOpen: (id: string) => void;
  onOpenApps?: () => void;
}): React.ReactElement {
  const windowFocused = useWindowFocused();
  const noAgents = groups !== null && blobs.length === 0;
  const loading = groups === null && !error;

  const create = (
    <MetalButton
      windowFocused={windowFocused}
      className="btn btn-primary btn-sm"
      disabled={noAgents}
      title={noAgents ? "Create a specialist first" : undefined}
      onClick={onCreate}
    >
      + New group
    </MetalButton>
  );

  const byId = useMemo(() => new Map(blobs.map((b) => [b.id, b])), [blobs]);

  return (
    <>
      <KleioHead
        onBack={onClose}
        title="Groups"
        status={groups !== null && <Badge>{groups.length}</Badge>}
        actions={
          <>
            {onOpenApps && <AppsButton onClick={onOpenApps} />}
            {create}
          </>
        }
      />
      <div className="picker-list kleio-list-scroll">
        {loading && <ListSkeleton rows={3} />}
        <ErrorLine error={error} />
        {groups !== null && groups.length === 0 && (
          <div className="picker-empty kleio-first">
            {blobs.length > 0 ? (
              <GroupAvatar members={blobs} color="lilac" size={72} />
            ) : (
              <BlobAvatar look={{ shape: "mochi", face: "curious", color: "lilac" }} size={64} />
            )}
            <h2 className="kleio-first-title">No groups yet</h2>
            <p className="kleio-first-text" style={{ color: theme.textMuted }}>
              {noAgents
                ? "A group chat brings several specialists together. Create a specialist first, then add it to a group."
                : "A group chat brings several specialists together. Everyone replies, or @mention one to ask just them."}
            </p>
            {!noAgents && create}
          </div>
        )}
        {groups !== null && groups.length > 0 && (
          <div className="picker-reveal">
            {groups.map((g) => {
              const state = groupRowState(g);
              return (
                <button
                  key={g.id}
                  type="button"
                  className={`picker-item kleio-row${g.typing.length ? " is-running" : ""}`}
                  onClick={() => onOpen(g.id)}
                  aria-label={`${g.name}. ${state.text}. ${groupRowSub(g)}`}
                >
                  <AgentRowContent
                    name={g.name}
                    avatar={
                      <GroupAvatar members={groupMembers(g, byId)} color={g.color} size={36} />
                    }
                    sub={groupRowSub(g)}
                    state={state}
                  />
                </button>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}

// ─── new / edit ───────────────────────────────────────────────────────────

function GroupForm({
  group,
  blobs,
  onSaved,
  onCancel,
  onDeleted,
}: GroupFormProps): React.ReactElement {
  const form = useGroupForm({ ...(group ? { group } : {}), blobs, onSaved, onDeleted });
  const { name, setName, color, setColor, members, toggle, error } = form;
  const { colors, full, canSave, title, save, remove, missing, chosen } = form;
  const [confirmDelete, setConfirmDelete] = useState(false);
  const windowFocused = useWindowFocused();
  const formId = useId();
  const ids = {
    form: `${formId}-form`,
    name: `${formId}-name`,
    colour: `${formId}-colour`,
    members: `${formId}-members`,
  };

  const preview: RowState = { text: plural(members.length, "member"), tone: "plain" };

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
              {form.saveLabel}
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
          <div className="kleio-form-main">
            <KleioPanel
              title="Identity"
              description="Its name, and the colour behind its members in your list."
            >
              <div className="kleio-identity">
                <GroupAvatar members={chosen} color={color} size={72} />
                <div className="kleio-identity-fields">
                  <div className="kleio-field">
                    <label className="kleio-label" htmlFor={ids.name}>
                      Name
                    </label>
                    <input
                      id={ids.name}
                      className="modal-input"
                      value={name}
                      maxLength={GROUP_NAME_MAX}
                      required
                      autoFocus
                      placeholder="Kitchen crew"
                      onChange={(e) => setName(e.target.value)}
                    />
                  </div>
                </div>
              </div>
              <div className="kleio-field">
                <span className="kleio-label" id={ids.colour}>
                  Colour
                </span>
                <div className="kleio-swatches" role="radiogroup" aria-labelledby={ids.colour}>
                  {colors.map((c) => (
                    <button
                      key={c}
                      type="button"
                      role="radio"
                      aria-checked={color === c}
                      aria-label={BLOB_COLOR_LABEL[c]}
                      title={BLOB_COLOR_LABEL[c]}
                      className="kleio-swatch"
                      style={{ background: BLOB_TONES[c][1] }}
                      onClick={() => setColor(c)}
                    />
                  ))}
                </div>
              </div>
            </KleioPanel>

            <KleioPanel
              title="Members"
              count={members.length}
              description={`Pick up to ${MAX_MEMBERS} specialists.`}
            >
              {blobs.length === 0 && missing.length === 0 ? (
                <p className="kleio-empty">No specialists yet — create one first.</p>
              ) : (
                <ul className="kleio-member-picks" id={ids.members} aria-label="Members">
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
            </KleioPanel>
          </div>

          <aside className="kleio-form-side" aria-label="Group settings">
            <KleioPanel title="Preview">
              <div className="picker-item kleio-row kleio-preview" aria-hidden="true">
                <AgentRowContent
                  name={name.trim() || "Your group"}
                  avatar={<GroupAvatar members={chosen} color={color} size={36} />}
                  sub={
                    members.length
                      ? chosen.map((b) => b.name).join(", ") || "No messages yet — say hello."
                      : "Pick its members."
                  }
                  state={preview}
                />
              </div>
            </KleioPanel>
            <KleioPanel title="How it works">
              <HowItWorks />
            </KleioPanel>
            {group && (
              <KleioPanel
                title="Delete group"
                description="Removes the group chat. Its specialists stay."
              >
                <button
                  type="button"
                  className="btn btn-ghost btn-sm kleio-danger-btn"
                  onClick={() => setConfirmDelete(true)}
                >
                  <TrashIcon size={14} weight="bold" aria-hidden="true" />
                  Delete {group.name}
                </button>
              </KleioPanel>
            )}
          </aside>
        </div>
      </form>
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

// ─── the chat ─────────────────────────────────────────────────────────────

function GroupChat({
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
    loaded,
    typing,
    activity,
    outcomes,
    asks,
    polledAt,
    openActivity,
    toggleActivity,
    draft,
    setDraft,
    sending,
    stopping,
    error,
    setError,
    confirmNew,
    setConfirmNew,
    starting,
    logRef,
    inputRef,
    followHandlers,
    showDictation,
    dictation,
    byId,
    members,
    linkHandler,
    assets,
    answerAsk,
    startFresh,
    send,
    stop,
    mention,
    typingNames,
    busy,
  } = useGroupChat(group, blobs);
  const sidebar = useSidebar();
  const windowFocused = useWindowFocused();
  const sideId = useId();

  const chat = (
    <div className="kleio-chat">
      <div
        ref={logRef}
        className="kleio-transcript"
        role="log"
        aria-live="polite"
        aria-label={`${group.name} conversation`}
        tabIndex={0}
        {...followHandlers}
      >
        <div className="kleio-transcript-inner">
          {!loaded && !error && <p className="kleio-chat-hint">Opening…</p>}
          {loaded && messages.length === 0 && (
            <div className="kleio-chat-intro">
              <GroupAvatar members={members} color={group.color} size={80} />
              <p className="kleio-chat-hint">
                Say hello. The best-placed specialist starts, or @mention who you want, in order.
              </p>
            </div>
          )}
          {messages.map((m) => {
            if (m.author === "you")
              return (
                <div key={m.id} className="user-msg">
                  {m.text}
                </div>
              );
            const b = byId.get(m.author);
            const owner = fileOwner(m.author, group.id);
            return (
              <div key={m.id} className="kleio-gmsg">
                {b ? (
                  <AgentAvatar agent={b} size={28} />
                ) : (
                  <span className="kleio-member-gone" aria-hidden="true" />
                )}
                <div className="kleio-gmsg-body">
                  <span className="kleio-gmsg-name">{m.authorName}</span>
                  <div className="assistant-text">
                    <LinkHandlerProvider value={linkHandler(m.author)}>
                      <Markdown>{m.text}</Markdown>
                    </LinkHandlerProvider>
                    <FileCards owner={owner} links={fileLinks(m.text, owner)} />
                  </div>
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
          {typingNames.length > 0 && Object.keys(asks).length === 0 && (
            <div className="kleio-gmsg kleio-typing" role="status">
              <span className="kleio-typing-dots" aria-hidden="true">
                <i />
                <i />
                <i />
              </span>
              <span className="kleio-typing-names">
                {`${typingNames.join(", ")} ${typingNames.length === 1 ? "is" : "are"} replying…`}
              </span>
            </div>
          )}
        </div>
      </div>

      <form
        className="kleio-composer"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <ErrorLine error={error} />
        {/* What the replying members are doing right now, as in a Code chat. */}
        <LiveToolFeed
          label="What the members are doing"
          nowMs={polledAt}
          calls={members
            .filter((m) => typing.includes(m.id))
            .map((m) => ({
              who: typing.length > 1 ? m.name : undefined,
              entries: activity[m.id] ?? [],
            }))}
        />
        {members.length > 1 && (
          <div className="kleio-mentions" role="group" aria-label="Mention a member">
            {members.map((m) => (
              <button
                key={m.id}
                type="button"
                className="kleio-mention"
                onClick={() => mention(m.name)}
              >
                <AgentAvatar agent={m} size={18} />@{m.name}
              </button>
            ))}
          </div>
        )}
        <div className="inputwrap">
          <WorkingBeam active={busy} />
          <div className="inputrow">
            <div className="input-stack">
              <textarea
                ref={inputRef}
                className="input"
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
            </div>
            <div className="inputactions-trailing">
              {showDictation && <DictateButton dictation={dictation} />}
              <WorkingBeam active={busy} size="sm" />
              <ActionMetal
                active={!sending && Boolean(draft.trim())}
                windowFocused={windowFocused}
              />
              {busy || sending ? (
                <button
                  type="button"
                  className="icon-circle icon-circle-primary"
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
                  className="icon-circle icon-circle-primary"
                  title="Send"
                  aria-label="Send"
                  disabled={!draft.trim()}
                >
                  <ArrowUpIcon size={16} aria-hidden="true" />
                </button>
              )}
            </div>
          </div>
          {showDictation && <DictationStatus dictation={dictation} />}
        </div>
      </form>
    </div>
  );

  const side = (
    <>
      <KleioPanel
        title="Members"
        count={group.members.length}
        action={
          <button type="button" className="kleio-text-btn" onClick={onEdit}>
            <PencilSimpleIcon size={12} weight="bold" aria-hidden="true" />
            Edit
          </button>
        }
      >
        <ul className="kleio-members">
          {members.map((m) => {
            const replying = typing.includes(m.id);
            const line = replying ? { text: "Replying…", tone: " is-live" as const } : null;
            return (
              <li key={m.id} className="kleio-member-item">
                <div className="kleio-member">
                  <AgentAvatar agent={m} size={30} live={replying} />
                  <span className="kleio-member-text">
                    <span className="kleio-member-name">{m.name}</span>
                    <span className={`kleio-member-sub${line?.tone ?? ""}`}>
                      {line?.text ?? m.job}
                    </span>
                  </span>
                  <button
                    type="button"
                    className="kleio-text-btn"
                    aria-label={`Mention ${m.name}`}
                    title={`Mention ${m.name}`}
                    onClick={() => mention(m.name)}
                  >
                    @
                  </button>
                </div>
                <MemberActivity
                  name={m.name}
                  entries={activity[m.id] ?? []}
                  outcome={outcomes[m.id] ?? null}
                  replying={replying}
                  nowMs={polledAt}
                  open={openActivity.has(m.id)}
                  onToggle={() => toggleActivity(m.id)}
                />
              </li>
            );
          })}
          {group.members.length > members.length && (
            <li className="kleio-member is-missing">
              <span className="kleio-member-sub">
                {plural(group.members.length - members.length, "deleted specialist")} — edit the
                group to remove.
              </span>
            </li>
          )}
        </ul>
      </KleioPanel>
      <AssetsPanel assets={assets} onError={setError} />
      <KleioPanel title="How it works">
        <HowItWorks />
      </KleioPanel>
    </>
  );

  return (
    <>
      <KleioHead
        onBack={onBack}
        tools={
          <>
            <SideToggle sidebar={sidebar} controls={sideId} />
            <NewChatButton onClick={() => setConfirmNew(true)} disabled={starting} />
          </>
        }
        leading={<GroupAvatar members={members} color={group.color} size={30} />}
        title={group.name}
        subtitle={
          busy ? (
            <Badge className="kleio-state is-live">Replying…</Badge>
          ) : (
            <Badge>{plural(group.members.length, "member")}</Badge>
          )
        }
        actions={
          <button type="button" className="btn btn-ghost btn-sm" onClick={onEdit}>
            <PencilSimpleIcon size={14} weight="bold" aria-hidden="true" />
            Edit
          </button>
        }
      />
      <KleioSplit
        main={chat}
        side={side}
        sideId={sideId}
        sideLabel={`${group.name} details`}
        sidebar={sidebar}
      />
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
    </>
  );
}

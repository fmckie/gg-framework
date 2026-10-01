// Groups: a group chat with several agents at once, from the Kleio host. A
// list laid out like Chats and Code; a group opens into its chat with a
// sidebar of its members on the left (collapsible from the header), and
// new/edit are full-page forms. A group's picture is its members' blobs.

import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ArrowUpIcon, CheckIcon, PencilSimpleIcon, TrashIcon } from "@phosphor-icons/react";
import { ActionMetal } from "../ActionMetal";
import { Badge } from "../Badge";
import { autosizeComposer } from "../composer-autosize";
import { ConfirmModal } from "../ConfirmModal";
import { LinkHandlerProvider, Markdown } from "../Markdown";
import { MetalButton } from "../MetalButton";
import { ListSkeleton } from "../Skeleton";
import { theme } from "../theme";
import { useWindowFocused } from "../useWindowFocused";
import { WorkingBeam } from "../WorkingBeam";
import { AgentRowContent, type RowState } from "./AgentRow";
import { AgentAvatar, BlobAvatar, GroupAvatar } from "./BlobAvatar";
import { BLOB_COLOR_LABEL, BLOB_TONES } from "./blobLook";
import { FileCards } from "./FileCard";
import {
  AppsButton,
  KleioHead,
  KleioPanel,
  KleioSplit,
  SideToggle,
  useSidebar,
} from "./KleioChrome";
import { agentFilePath, fileErrorText, fileLinks, fileOwner, openFile } from "./kleioFiles";
import { relTime } from "./relTime";
import {
  BLOB_COLORS,
  createGroup,
  deleteGroup,
  listBlobs,
  listGroupMessages,
  listGroups,
  sendGroupMessage,
  updateGroup,
  errorText,
  type Blob,
  type BlobColor,
  type Group,
  type GroupMessage,
} from "./kleioApi";

/** The host allows 1–8 agents in a group. */
const MAX_MEMBERS = 8;
const NAME_MAX = 40;
const MESSAGE_MAX = 4000;
const GROUP_POLL_MS = 1500;
const LIST_REFRESH_MS = 10_000;
const PIN_SLACK_PX = 40;
/** Hosts from before agent looks accept only the original six colours. */
const ORIGINAL_COLORS: readonly BlobColor[] = BLOB_COLORS.slice(0, 6);

/** The agents in a group that still exist, in member order. */
function groupMembers(g: Pick<Group, "members">, byId: ReadonlyMap<string, Blob>): Blob[] {
  return g.members.map((id) => byId.get(id)).filter((b): b is Blob => b !== undefined);
}

/** How the host runs a group chat (see kleio-host groups.ts). */
const HOW_IT_WORKS = [
  "Send a message and every member replies, in member order.",
  "@mention an agent to ask just them.",
  "Agents can @mention each other to hand over.",
];

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

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

/** The short state at the right of a group's row. */
function groupRowState(g: Group, now: number = Date.now()): RowState {
  if (g.typing.length > 0) return { text: "Replying…", tone: "live" };
  // Relative, like the Chats list ("2 h ago").
  if (g.lastMessage) return { text: relTime(g.lastMessage.at, now), tone: "plain" };
  return { text: plural(g.members.length, "member"), tone: "plain" };
}

function groupRowSub(g: Group): string {
  return g.lastMessage
    ? `${g.lastMessage.authorName}: ${g.lastMessage.text}`
    : "No messages yet — say hello.";
}

type View = { kind: "list" } | { kind: "chat"; id: string } | { kind: "form"; id: string | null };

export function GroupsPage({
  onClose,
  onListChange,
  onOpenApps,
}: {
  /** Leave Groups (Back on the list). */
  onClose: () => void;
  /** Told whether the list is showing, so the screen can show its switcher. */
  onListChange?: (atList: boolean) => void;
  /** Open the Apps page (a "Connect apps" button on the list). */
  onOpenApps?: () => void;
}): React.ReactElement {
  const [groups, setGroups] = useState<Group[] | null>(null);
  const [blobs, setBlobs] = useState<Blob[]>([]);
  const [view, setView] = useState<View>({ kind: "list" });
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
    return (
      <GroupForm
        {...(group ? { group } : {})}
        blobs={blobs}
        onCancel={() => setView(group ? { kind: "chat", id: group.id } : { kind: "list" })}
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
    if (group)
      return (
        <GroupChat
          group={group}
          blobs={blobs}
          onBack={toList}
          onEdit={() => setView({ kind: "form", id: group.id })}
        />
      );
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

  return (
    <GroupList
      groups={groups}
      blobs={blobs}
      error={error}
      onClose={onClose}
      onCreate={() => setView({ kind: "form", id: null })}
      onOpen={(id) => setView({ kind: "chat", id })}
      {...(onOpenApps ? { onOpenApps } : {})}
    />
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
      title={noAgents ? "Create an agent first" : undefined}
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
                ? "A group chat brings several agents together. Create an agent first, then add it to a group."
                : "A group chat brings several agents together. Everyone replies, or @mention one to ask just them."}
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
}: {
  group?: Group;
  blobs: Blob[];
  onSaved: (g: Group) => void;
  onCancel: () => void;
  onDeleted: () => void;
}): React.ReactElement {
  const [name, setName] = useState(group?.name ?? "");
  const [color, setColor] = useState<BlobColor>(group?.color ?? "lilac");
  const [members, setMembers] = useState<string[]>(group?.members ?? []);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const windowFocused = useWindowFocused();
  const formId = useId();
  const ids = {
    form: `${formId}-form`,
    name: `${formId}-name`,
    colour: `${formId}-colour`,
    members: `${formId}-members`,
  };
  // A host that knows agent looks also accepts the larger palette.
  const colors = blobs.some((b) => b.shape !== undefined) ? BLOB_COLORS : ORIGINAL_COLORS;
  const full = members.length >= MAX_MEMBERS;
  const canSave = !saving && Boolean(name.trim()) && members.length > 0;
  const title = group ? `Edit ${group.name}` : "New group";

  async function save(): Promise<void> {
    if (!canSave) return;
    setSaving(true);
    setError(null);
    try {
      // `emoji` is kept for the iPhone app, which still shows it.
      const input = { name: name.trim(), emoji: group?.emoji ?? "💬", color, members };
      onSaved(group ? await updateGroup(group.id, input) : await createGroup(input));
    } catch (err) {
      setError(errorText(err));
      setSaving(false);
    }
  }

  async function remove(): Promise<void> {
    if (!group) return;
    try {
      await deleteGroup(group.id);
      onDeleted();
    } catch (err) {
      setError(errorText(err));
    }
  }

  function toggle(id: string): void {
    setMembers((cur) =>
      cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id].slice(0, MAX_MEMBERS),
    );
  }

  // Members of this group whose agent has since been deleted still count on
  // the host; show them so the count adds up and they can be removed.
  const byId = new Map(blobs.map((b) => [b.id, b]));
  const missing = members.filter((id) => !byId.has(id));
  const chosen = groupMembers({ members }, byId);

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
              {saving ? "Saving…" : group ? "Save" : "Create"}
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
                      maxLength={NAME_MAX}
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
              description={`Pick up to ${MAX_MEMBERS} agents.`}
            >
              {blobs.length === 0 && missing.length === 0 ? (
                <p className="kleio-empty">No agents yet — create one first.</p>
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
                          <span className="kleio-member-name">Deleted agent</span>
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
                description="Removes the group chat. Its agents stay."
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
          message="The group chat and its messages go. Its agents stay. This can't be undone."
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
  const [messages, setMessages] = useState<GroupMessage[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [typing, setTyping] = useState<string[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sidebar = useSidebar();
  const lastSeq = useRef(0);
  const logRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const windowFocused = useWindowFocused();
  const sideId = useId();
  const byId = useMemo(() => new Map(blobs.map((b) => [b.id, b])), [blobs]);
  const members = groupMembers(group, byId);

  // A click on a link to a member's file opens it on this Mac. Links in a
  // message point into its author's own folder inside the group.
  const linkHandler = useCallback(
    (authorId: string) =>
      (href: string): boolean => {
        const path = agentFilePath(href);
        if (!path) return false;
        openFile(fileOwner(authorId, group.id), path).catch((e: unknown) =>
          setError(fileErrorText(e)),
        );
        return true;
      },
    [group.id],
  );

  useEffect(() => {
    let live = true;
    lastSeq.current = 0;
    setMessages([]);
    setLoaded(false);
    const tick = async (): Promise<void> => {
      if (document.hidden) return;
      try {
        const page = await listGroupMessages(group.id, { after: lastSeq.current, limit: 200 });
        if (!live) return;
        if (page.messages.length) {
          lastSeq.current = page.lastSeq;
          setMessages((cur) => [...cur, ...page.messages]);
        }
        setTyping(page.typing);
        setLoaded(true);
        setError(null);
      } catch (e) {
        if (live) setError(errorText(e));
      }
    };
    void tick();
    const id = window.setInterval(() => void tick(), GROUP_POLL_MS);
    return () => {
      live = false;
      window.clearInterval(id);
    };
  }, [group.id]);

  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, typing]);

  useLayoutEffect(() => {
    const log = logRef.current;
    const pinned = log ? log.scrollHeight - log.scrollTop - log.clientHeight < PIN_SLACK_PX : true;
    autosizeComposer(inputRef.current, log, pinned);
  }, [draft]);

  async function send(): Promise<void> {
    const text = draft.trim();
    if (!text || sending) return;
    setSending(true);
    setDraft("");
    try {
      await sendGroupMessage(group.id, text);
    } catch (e) {
      setError(errorText(e));
      setDraft(text);
    } finally {
      setSending(false);
    }
  }

  function mention(name: string): void {
    setDraft((d) => `${d}${d && !d.endsWith(" ") ? " " : ""}@${name} `);
    inputRef.current?.focus();
  }

  const typingNames = typing.map((id) => byId.get(id)?.name ?? "Someone");
  const busy = typing.length > 0;

  const chat = (
    <div className="kleio-chat">
      <div
        ref={logRef}
        className="kleio-transcript"
        role="log"
        aria-live="polite"
        aria-label={`${group.name} conversation`}
        tabIndex={0}
      >
        <div className="kleio-transcript-inner">
          {!loaded && !error && <p className="kleio-chat-hint">Opening…</p>}
          {loaded && messages.length === 0 && (
            <div className="kleio-chat-intro">
              <GroupAvatar members={members} color={group.color} size={80} />
              <p className="kleio-chat-hint">
                Say hello. Everyone replies, or @mention one of them to ask just them.
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
                    <FileCards owner={owner} links={fileLinks(m.text)} />
                  </div>
                </div>
              </div>
            );
          })}
          {typingNames.length > 0 && (
            <div className="kleio-gmsg kleio-typing" role="status">
              <span className="kleio-typing-dots" aria-hidden="true">
                <i />
                <i />
                <i />
              </span>
              <span className="kleio-typing-names">
                {typingNames.join(", ")} {typingNames.length === 1 ? "is" : "are"} replying…
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
              <WorkingBeam active={busy} size="sm" />
              <ActionMetal
                active={!sending && Boolean(draft.trim())}
                windowFocused={windowFocused}
              />
              <button
                type="submit"
                className="icon-circle icon-circle-primary"
                title="Send"
                aria-label="Send"
                disabled={sending || !draft.trim()}
              >
                <ArrowUpIcon size={16} aria-hidden="true" />
              </button>
            </div>
          </div>
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
            return (
              <li key={m.id} className="kleio-member">
                <AgentAvatar agent={m} size={30} live={replying} />
                <span className="kleio-member-text">
                  <span className="kleio-member-name">{m.name}</span>
                  <span className={`kleio-member-sub${replying ? " is-live" : ""}`}>
                    {replying ? "Replying…" : m.job}
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
              </li>
            );
          })}
          {group.members.length > members.length && (
            <li className="kleio-member is-missing">
              <span className="kleio-member-sub">
                {plural(group.members.length - members.length, "deleted agent")} — edit the group to
                remove.
              </span>
            </li>
          )}
        </ul>
      </KleioPanel>
      <KleioPanel title="How it works">
        <HowItWorks />
      </KleioPanel>
    </>
  );

  return (
    <>
      <KleioHead
        onBack={onBack}
        tools={<SideToggle sidebar={sidebar} controls={sideId} />}
        leading={<GroupAvatar members={members} color={group.color} size={30} />}
        title={group.name}
        status={
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
    </>
  );
}

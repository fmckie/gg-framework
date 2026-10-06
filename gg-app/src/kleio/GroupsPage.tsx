// Groups: a group chat with several specialists at once, from the Kleio host. A
// list laid out like Chats and Code; a group opens into its chat with a
// sidebar of its members on the left (collapsible from the header), and
// new/edit are full-page forms. A group's picture is its members' blobs.

import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  ArrowUpIcon,
  CaretRightIcon,
  CheckIcon,
  PencilSimpleIcon,
  SquareIcon,
  TrashIcon,
} from "@phosphor-icons/react";
import { ActionMetal } from "../ActionMetal";
import { isAskUserPrompt, type AskAnswers, type AskUserPrompt } from "../ask-user";
import { Badge } from "../Badge";
import { autosizeComposer } from "../composer-autosize";
import { ConfirmModal } from "../ConfirmModal";
import { appendDictation, DictateButton, DictationStatus } from "../DictateButton";
import { LinkHandlerProvider, Markdown } from "../Markdown";
import { MetalButton } from "../MetalButton";
import { isPhone } from "../platform";
import { ListSkeleton } from "../Skeleton";
import { theme } from "../theme";
import { formatDuration } from "../SubAgentFeed";
import { toast } from "../toast";
import { buildSummaryLineParts } from "../tool-format";
import { ToolRow, type ToolRowState } from "../ToolRow";
import { useDictation } from "../useDictation";
import { useWindowFocused } from "../useWindowFocused";
import { WorkingBeam } from "../WorkingBeam";
import { AgentRowContent, type RowState } from "./AgentRow";
import { AgentAvatar, BlobAvatar, GroupAvatar } from "./BlobAvatar";
import { BLOB_COLOR_LABEL, BLOB_TONES } from "./blobLook";
import { ChatAsk, typedAnswer } from "./ChatAsk";
import { FileCards } from "./FileCard";
import { AssetsPanel, collectAssets } from "./AssetsPanel";
import {
  AppsButton,
  KleioHead,
  KleioPanel,
  KleioSplit,
  NewChatButton,
  SideToggle,
  useSidebar,
} from "./KleioChrome";
import { fileErrorText, fileLinks, fileOwner, openFile, ownerFilePath } from "./kleioFiles";
import { relTime } from "./relTime";
import {
  answerGroupAsk,
  BLOB_COLORS,
  createGroup,
  deleteGroup,
  listBlobs,
  listGroupMessages,
  listGroups,
  newGroupSession,
  sendGroupMessage,
  stopGroup,
  updateGroup,
  errorText,
  type Blob,
  type BlobColor,
  type Group,
  type GroupActivityEntry,
  type GroupMessage,
  type GroupTurnOutcome,
  type GroupTurnOutcomeKind,
} from "./kleioApi";
import { useFollowLatest } from "./useFollowLatest";

/** The host allows 1–8 agents in a group. */
const MAX_MEMBERS = 8;
const NAME_MAX = 40;
const MESSAGE_MAX = 4000;
const GROUP_POLL_MS = 1500;
const LIST_REFRESH_MS = 10_000;
/** Hosts from before agent looks accept only the original six colours. */
const ORIGINAL_COLORS: readonly BlobColor[] = BLOB_COLORS.slice(0, 6);

/** The agents in a group that still exist, in member order. */
function groupMembers(g: Pick<Group, "members">, byId: ReadonlyMap<string, Blob>): Blob[] {
  return g.members.map((id) => byId.get(id)).filter((b): b is Blob => b !== undefined);
}

/** How the host runs a group chat (see kleio-host groups.ts). */
const HOW_IT_WORKS = [
  "Send a message and the specialist best placed for it starts; others join in as needed.",
  "@mention specialists to choose who replies, in the order you mention them.",
  "Specialists can @mention each other to hand over.",
  "The pen button starts a new conversation; the old one stays on your Mac mini.",
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

const OUTCOME_LABEL: Record<GroupTurnOutcomeKind, string> = {
  replied: "Replied",
  passed: "Passed",
  timed_out: "Stopped",
  failed: "Failed",
  unavailable: "Couldn't start",
  budget_exhausted: "Not reached",
};

/** The colour an outcome shows in: a stop is an error, a skipped turn a warning. */
function outcomeTone(kind: GroupTurnOutcomeKind): "" | " is-error" | " is-warning" {
  if (kind === "timed_out" || kind === "failed" || kind === "unavailable") return " is-error";
  return kind === "budget_exhausted" ? " is-warning" : "";
}

/** A call's time so far, or in all once it ended (host clock both ends). */
function callMs(e: GroupActivityEntry, nowMs: number): number {
  const start = Date.parse(e.startedAt);
  const end = e.endedAt ? Date.parse(e.endedAt) : nowMs;
  return Number.isFinite(start) && Number.isFinite(end) ? Math.max(0, end - start) : 0;
}

const STEP_FILE_CHARS = 28;

/** A tool call in plain words, for the phone: "Reading notes.md", "Running a command". */
export function stepText(e: Pick<GroupActivityEntry, "name" | "summary">): string {
  const last = e.summary.trim().split(/[\\/]/).filter(Boolean).pop() ?? "";
  const file = [...last].length > STEP_FILE_CHARS ? "" : last;
  switch (e.name) {
    case "bash":
      return "Running a command";
    case "read":
      return file ? `Reading ${file}` : "Reading a file";
    case "write":
      return file ? `Writing ${file}` : "Writing a file";
    case "edit":
      return file ? `Editing ${file}` : "Editing a file";
    case "ls":
    case "grep":
    case "find":
      return "Searching files";
    case "web_fetch":
      return "Reading a web page";
    case "web_search":
      return "Searching the web";
    case "subagent":
      return "Handing off a task";
    default:
      return buildSummaryLineParts(e.name, "", false)[0]?.text ?? "Working";
  }
}

/**
 * A member's state in one line, for the phone: what it's doing right now and
 * for how long, or why its last turn didn't reply; null when there's nothing
 * to say (its job shows instead).
 */
export function memberLine(
  entries: readonly GroupActivityEntry[],
  outcome: GroupTurnOutcome | null,
  replying: boolean,
  nowMs: number,
): { text: string; tone: "" | " is-live" | " is-error" | " is-warning" } | null {
  if (replying) {
    const step = [...entries].reverse().find((e) => e.status === "running");
    return {
      text: step ? `${stepText(step)} · ${formatDuration(callMs(step, nowMs))}` : "Thinking…",
      tone: " is-live",
    };
  }
  if (!outcome || outcome.kind === "replied" || outcome.kind === "passed") return null;
  const label = OUTCOME_LABEL[outcome.kind] ?? "Ended";
  return {
    text:
      outcome.reason && outcome.kind !== "budget_exhausted" ? `${label}: ${outcome.reason}` : label,
    tone: outcomeTone(outcome.kind),
  };
}

const sameIds = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && a.every((id, i) => id === b[i]);

/** The questions the host reports, keeping only well-formed ones. */
export function validAsks(raw: Record<string, unknown> | undefined): Record<string, AskUserPrompt> {
  const out: Record<string, AskUserPrompt> = {};
  for (const [bid, p] of Object.entries(raw ?? {})) if (isAskUserPrompt(p)) out[bid] = p;
  return out;
}

/** `next`, but the same object when nothing changed (a band keeps what you picked). */
function sameAsks(
  cur: Record<string, AskUserPrompt>,
  next: Record<string, AskUserPrompt>,
): Record<string, AskUserPrompt> {
  const keys = Object.keys(next);
  const same =
    keys.length === Object.keys(cur).length && keys.every((k) => cur[k]?.id === next[k]?.id);
  return same ? cur : next;
}

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
  entries: readonly GroupActivityEntry[];
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
            {entries.map((e) => {
              const state: ToolRowState =
                e.status === "running" ? "running" : e.status === "failed" ? "failed" : "done";
              const took = formatDuration(callMs(e, nowMs));
              return (
                <ToolRow
                  key={e.id}
                  as="li"
                  state={state}
                  title={e.summary || undefined}
                  parts={buildSummaryLineParts(e.name, e.summary, state !== "running")}
                >
                  <span
                    className={`kleio-activity-time${
                      state === "failed" ? " is-error" : state === "running" ? " is-live" : ""
                    }`}
                  >
                    {state === "failed"
                      ? `failed · ${took}`
                      : state === "running"
                        ? `live · ${took}`
                        : took}
                  </span>
                </ToolRow>
              );
            })}
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
  const [messages, setMessages] = useState<GroupMessage[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [typing, setTyping] = useState<string[]>([]);
  const [activity, setActivity] = useState<Record<string, GroupActivityEntry[]>>({});
  const [outcomes, setOutcomes] = useState<Record<string, GroupTurnOutcome>>({});
  /** Members' questions waiting on you, by member id. */
  const [asks, setAsks] = useState<Record<string, AskUserPrompt>>({});
  const [polledAt, setPolledAt] = useState(0);
  /** Members whose activity is expanded. */
  const [openActivity, setOpenActivity] = useState<ReadonlySet<string>>(() => new Set());
  const wasTyping = useRef<readonly string[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmNew, setConfirmNew] = useState(false);
  const [starting, setStarting] = useState(false);
  const sidebar = useSidebar();
  const lastSeq = useRef(0);
  /** Messages up to this seq belong to a conversation a new session cleared. */
  const clearedThrough = useRef(0);
  const logRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const windowFocused = useWindowFocused();
  const { following, catchUp, follow, handlers: followHandlers } = useFollowLatest(logRef);
  // iPhone dictation: the transcript joins the draft for review before sending.
  const phoneComposer = isPhone();
  // The phone shows each member's state in one line, not its tool calls.
  const phone = phoneComposer;
  const dictation = useDictation({
    onText: (text) => setDraft((prev) => appendDictation(prev, text, MESSAGE_MAX)),
    onError: (message) => toast(message, "error"),
  });
  const sideId = useId();
  const byId = useMemo(() => new Map(blobs.map((b) => [b.id, b])), [blobs]);
  const members = groupMembers(group, byId);

  // A click on a link to a member's file opens it on this Mac. Links in a
  // message point into its author's own folder inside the group.
  const linkHandler = useCallback(
    (authorId: string) =>
      (href: string): boolean => {
        const owner = fileOwner(authorId, group.id);
        const path = ownerFilePath(href, owner);
        if (!path) return false;
        openFile(owner, path).catch((e: unknown) => setError(fileErrorText(e)));
        return true;
      },
    [group.id],
  );

  useEffect(() => {
    let live = true;
    lastSeq.current = 0;
    clearedThrough.current = 0;
    setMessages([]);
    setActivity({});
    setOutcomes({});
    setAsks({});
    setOpenActivity(new Set());
    wasTyping.current = [];
    setLoaded(false);
    follow();
    const tick = async (): Promise<void> => {
      if (document.hidden) return;
      try {
        const page = await listGroupMessages(group.id, { after: lastSeq.current, limit: 200 });
        if (!live) return;
        // A new session (from any device) clears what came before it.
        const cleared = Math.max(clearedThrough.current, page.clearedThrough ?? 0);
        const fresh = page.messages.filter((m) => m.seq > cleared);
        if (page.messages.length) lastSeq.current = page.lastSeq;
        if (fresh.length || cleared > clearedThrough.current) {
          clearedThrough.current = cleared;
          setMessages((cur) => [...cur.filter((m) => m.seq > cleared), ...fresh]);
        }
        // The same list keeps the same array: an idle poll changes nothing.
        setTyping((cur) => (sameIds(cur, page.typing) ? cur : page.typing));
        // Older hosts send neither.
        setActivity(page.activity ?? {});
        setOutcomes(page.outcomes ?? {});
        // Same questions: keep the objects, so a band keeps what you picked.
        setAsks((cur) => sameAsks(cur, validAsks(page.asks)));
        setPolledAt(Date.now());
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
  }, [group.id, follow]);

  // New messages carry along only a reader at the newest one, never one
  // scrolled up to read. Only real changes: a catch-up on every poll lands
  // on a scroll the reader has just begun and snaps it back down.
  useEffect(() => {
    catchUp();
  }, [messages, typing, asks, catchUp]);

  // Every file the members linked, newest first, for the Assets panel.
  const assets = useMemo(
    () =>
      collectAssets(
        messages,
        (m) => (m.author === "you" ? null : fileOwner(m.author, group.id)),
        (m) => m.authorName,
      ),
    [messages, group.id],
  );

  async function answerAsk(bid: string, prompt: AskUserPrompt, answers: AskAnswers): Promise<void> {
    await answerGroupAsk(group.id, prompt.id, "answer", answers);
    setAsks((cur) => {
      if (cur[bid]?.id !== prompt.id) return cur;
      const { [bid]: _answered, ...rest } = cur;
      return rest;
    });
  }

  async function startFresh(): Promise<void> {
    setStarting(true);
    setError(null);
    try {
      const g = await newGroupSession(group.id);
      clearedThrough.current = Math.max(clearedThrough.current, g.clearedThrough ?? 0);
      setMessages([]);
      setTyping([]);
      setActivity({});
      setOutcomes({});
      setAsks({});
      setOpenActivity(new Set());
      follow();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setStarting(false);
      setConfirmNew(false);
    }
  }

  // A member that starts replying opens its activity; it stays open after, to
  // show how the turn ended, until the user closes it.
  useEffect(() => {
    const started = typing.filter((id) => !wasTyping.current.includes(id));
    wasTyping.current = typing;
    if (started.length) setOpenActivity((cur) => new Set([...cur, ...started]));
  }, [typing]);

  const toggleActivity = useCallback((id: string) => {
    setOpenActivity((cur) => {
      const next = new Set(cur);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  }, []);

  useLayoutEffect(() => {
    autosizeComposer(inputRef.current, logRef.current, following());
  }, [draft, following]);

  async function send(): Promise<void> {
    const text = draft.trim();
    if (!text || sending) return;
    // A member's question is waiting: what's typed answers it (its turn is
    // blocked on it), rather than going in as a new message.
    const waiting = Object.entries(asks)[0];
    const typed = waiting ? typedAnswer(waiting[1], text) : null;
    if (waiting && typed) {
      setSending(true);
      setDraft("");
      try {
        await answerAsk(waiting[0], waiting[1], typed);
      } catch (e) {
        setError(errorText(e));
        setDraft(text);
      } finally {
        setSending(false);
      }
      return;
    }
    setSending(true);
    setDraft("");
    // Sending means following the replies, wherever the reader had scrolled.
    follow();
    try {
      await sendGroupMessage(group.id, text);
    } catch (e) {
      setError(errorText(e));
      setDraft(text);
    } finally {
      setSending(false);
    }
  }

  async function stop(): Promise<void> {
    if (stopping) return;
    setStopping(true);
    setError(null);
    try {
      await stopGroup(group.id);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setStopping(false);
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
                {phone && typing.length === 1 && typing[0]
                  ? `${typingNames[0]}: ${
                      memberLine(activity[typing[0]] ?? [], null, true, polledAt)?.text ??
                      "replying…"
                    }`
                  : `${typingNames.join(", ")} ${typingNames.length === 1 ? "is" : "are"} replying…`}
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
              {phoneComposer && <DictateButton dictation={dictation} />}
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
          {phoneComposer && <DictationStatus dictation={dictation} />}
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
            const line = phone
              ? memberLine(activity[m.id] ?? [], outcomes[m.id] ?? null, replying, polledAt)
              : replying
                ? { text: "Replying…", tone: " is-live" as const }
                : null;
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
                {!phone && (
                  <MemberActivity
                    name={m.name}
                    entries={activity[m.id] ?? []}
                    outcome={outcomes[m.id] ?? null}
                    replying={replying}
                    nowMs={polledAt}
                    open={openActivity.has(m.id)}
                    onToggle={() => toggleActivity(m.id)}
                  />
                )}
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
      {confirmNew && (
        <ConfirmModal
          title="Start a new conversation?"
          message={`Every device switches to a fresh conversation with ${group.name}, and any reply in progress stops. The old one stays on your Mac mini.`}
          confirmLabel="New conversation"
          busy={starting}
          onConfirm={() => void startFresh()}
          onClose={() => setConfirmNew(false)}
        />
      )}
    </>
  );
}

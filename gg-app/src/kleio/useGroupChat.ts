// One group's conversation as the host holds it: its messages (polled), who is
// replying, what they are doing and how their turns ended, their questions, and
// sending, stopping and starting over. The iPhone's chat (GroupsPage.tsx) and
// the desktop's room (CastRoom.tsx) both draw from it, so they act the same.

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { isAskUserPrompt, type AskAnswers, type AskUserPrompt } from "../ask-user";
import { autosizeComposer } from "../composer-autosize";
import { appendDictation } from "../DictateButton";
import { supportsDictation } from "../platform";
import { toast } from "../toast";
import { useDictation } from "../useDictation";
import { collectAssets } from "./AssetsPanel";
import { typedAnswer } from "./ChatAsk";
import { isSitePath } from "./filePaths";
import { fileErrorText, fileOwner, ownerFilePath, siteErrorText } from "./kleioFiles";
import { startLiveActivity } from "./liveActivity";
import {
  answerGroupAsk,
  errorText,
  listGroupMessages,
  newGroupSession,
  sendGroupMessage,
  stopGroup,
  type Blob,
  type Group,
  type GroupMessage,
  type GroupTurnOutcome,
  type ToolActivityEntry,
} from "./kleioApi";
import { useFollowLatest } from "./useFollowLatest";
import { useOpenFile } from "./viewerContext";

export const MESSAGE_MAX = 4000;
const GROUP_POLL_MS = 1500;

/** The agents in a group that still exist, in member order. */
export function groupMembers(g: Pick<Group, "members">, byId: ReadonlyMap<string, Blob>): Blob[] {
  return g.members.map((id) => byId.get(id)).filter((b): b is Blob => b !== undefined);
}

export function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
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

/** Everything a group's chat holds and does; today's chat and the Cast's room draw it. */
export function useGroupChat(group: Group, blobs: readonly Blob[]) {
  const [messages, setMessages] = useState<GroupMessage[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [typing, setTyping] = useState<string[]>([]);
  const [activity, setActivity] = useState<Record<string, ToolActivityEntry[]>>({});
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
  const lastSeq = useRef(0);
  /** Messages up to this seq belong to a conversation a new session cleared. */
  const clearedThrough = useRef(0);
  const logRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const { following, catchUp, follow, handlers: followHandlers } = useFollowLatest(logRef);
  // Dictation (iPhone and Mac): the transcript joins the draft for review before sending.
  const showDictation = supportsDictation();
  const dictation = useDictation({
    onText: (text) => setDraft((prev) => appendDictation(prev, text, MESSAGE_MAX)),
    onError: (message) => toast(message, "error"),
  });
  const byId = useMemo(() => new Map(blobs.map((b) => [b.id, b])), [blobs]);
  const members = useMemo(() => groupMembers(group, byId), [group, byId]);

  // A click on a link to a member's file opens it: in the file viewer when
  // Kleio draws its kind, as a site for a web page, else in its app. Links in
  // a message point into its author's own folder inside the group.
  const openAt = useOpenFile();
  const linkHandler = useCallback(
    (authorId: string) =>
      (href: string): boolean => {
        const owner = fileOwner(authorId, group.id);
        const path = ownerFilePath(href, owner);
        if (!path) return false;
        openAt(owner, path).catch((e: unknown) =>
          setError(isSitePath(path) ? siteErrorText(e) : fileErrorText(e)),
        );
        return true;
      },
    [group.id, openAt],
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
      void startLiveActivity("group", group.name, { groupId: group.id });
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

  return {
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
  };
}

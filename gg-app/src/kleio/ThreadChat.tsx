// Chat onto a host-pinned conversation (an agent's chat). Deliberately NOT a
// GG Chat window: a window owns its sidecar session and disposes it on
// close/switch, which would kill the pinned thread every paired device shares.
// So this view only reads and prompts it — history from `/history`, liveness
// from `/state` (polled; fast while a run is going, so replies started from the
// phone or a schedule show up too), sends via `/prompt` — all through the
// allow-listed, session-scoped `kleio_api` routes. It wears the Code chat's
// own message and composer styles so the two chats look the same. Files the
// agent links to show as cards under its message; a fresh conversation is
// started from the page header (the page remounts this view).

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { AlarmIcon, ArrowUpIcon, SquareIcon } from "@phosphor-icons/react";
import type { HistoryEntry } from "../agent";
import { ActionMetal } from "../ActionMetal";
import { isAskUserPrompt, type AskAnswers, type AskUserPrompt } from "../ask-user";
import { autosizeComposer } from "../composer-autosize";
import { appendDictation, DictateButton, DictationStatus } from "../DictateButton";
import { LinkHandlerProvider, Markdown } from "../Markdown";
import { isPhone } from "../platform";
import { theme } from "../theme";
import { toast } from "../toast";
import { useDictation } from "../useDictation";
import { useWindowFocused } from "../useWindowFocused";
import { WorkingBeam } from "../WorkingBeam";
import { scheduledPrompt } from "./blobFormat";
import { ChatAsk, typedAnswer } from "./ChatAsk";
import { FileCards } from "./FileCard";
import { fileErrorText, fileLinks, openFile, ownerFilePath, type FileOwner } from "./kleioFiles";
import {
  KleioApiError,
  errorText,
  threadAnswerAsk,
  threadCancel,
  threadHistory,
  threadPrompt,
  threadState,
  type ThreadSession,
} from "./kleioApi";
import { useFollowLatest } from "./useFollowLatest";

const POLL_RUNNING_MS = 1500;
const POLL_IDLE_MS = 5000;

/** The first question the agent is waiting on, from `/state`'s `pendingAsks`. */
function firstAsk(pending: readonly unknown[] | undefined): AskUserPrompt | null {
  return pending?.find(isAskUserPrompt) ?? null;
}
/** The Code chat's assistant bullet. */
const DOT = "\u23FA";

function UserMessage({ text }: { text: string }): React.ReactElement {
  const scheduled = scheduledPrompt(text);
  if (!scheduled) return <div className="user-msg">{text}</div>;
  return (
    <div className="user-msg kleio-scheduled">
      <span className="kleio-scheduled-tag">
        <AlarmIcon size={12} weight="bold" aria-hidden="true" />
        Scheduled{scheduled.label ? ` · ${scheduled.label}` : ""}
      </span>
      {scheduled.prompt}
    </div>
  );
}

function AssistantMessage({
  text,
  owner,
}: {
  text: string;
  owner: FileOwner | undefined;
}): React.ReactElement {
  const links = useMemo(() => (owner ? fileLinks(text, owner) : []), [text, owner]);
  return (
    <div className="assistant-msg">
      <span className="assistant-dot" style={{ color: theme.primary }} aria-hidden="true">
        {DOT}
      </span>
      <div className="assistant-text">
        <Markdown>{text}</Markdown>
        {owner && <FileCards owner={owner} links={links} />}
      </div>
    </div>
  );
}

export function ThreadChat({
  label,
  resolve,
  owner,
  intro,
  onHistory,
}: {
  /** Who you're talking to, e.g. an agent's name. */
  label: string;
  /** GET the pinned session (idempotent on the host). */
  resolve: () => Promise<ThreadSession>;
  /** Whose folder the agent's file links point into. */
  owner?: FileOwner;
  /** Shown while the conversation is empty. */
  intro?: React.ReactNode;
  /** Told each time the conversation changes (e.g. to list the files it links). */
  onHistory?: (history: readonly HistoryEntry[]) => void;
}): React.ReactElement {
  const [session, setSession] = useState<string | null>(null);
  const [history, setHistory] = useState<HistoryEntry[] | null>(null);
  const [running, setRunning] = useState(false);
  /** The question the agent is waiting on you to answer, if any. */
  const [ask, setAsk] = useState<AskUserPrompt | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const logRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const alive = useRef(true);
  const windowFocused = useWindowFocused();
  const { following, catchUp, follow, handlers: followHandlers } = useFollowLatest(logRef);
  // iPhone dictation: the transcript joins the draft for review before sending.
  const phoneComposer = isPhone();
  const dictation = useDictation({
    onText: (text) => setDraft((prev) => appendDictation(prev, text)),
    onError: (message) => toast(message, "error"),
  });
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const open = useCallback(async (fn: () => Promise<ThreadSession>): Promise<void> => {
    setError(null);
    try {
      const s = await fn();
      if (!alive.current) return;
      setSession(s.sessionId);
      const [h, st] = await Promise.all([threadHistory(s.sessionId), threadState(s.sessionId)]);
      if (!alive.current) return;
      setHistory(h);
      setRunning(Boolean(st.running));
      setAsk(firstAsk(st.pendingAsks));
    } catch (e) {
      if (alive.current) setError(errorText(e));
    }
  }, []);

  useEffect(() => {
    setSession(null);
    setHistory(null);
    follow();
    void open(resolve);
  }, [open, resolve, follow]);

  // Poll: /state every tick; /history while a run is going and once when it ends.
  useEffect(() => {
    if (!session) return;
    let wasRunning = running;
    const tick = async (): Promise<void> => {
      try {
        const st = await threadState(session);
        const now = Boolean(st.running);
        if (now || wasRunning) {
          const h = await threadHistory(session);
          if (alive.current) setHistory(h);
        }
        wasRunning = now;
        if (alive.current) {
          setRunning(now);
          // Same question: keep the object, so its band keeps what you picked.
          const next = firstAsk(st.pendingAsks);
          setAsk((cur) => (cur?.id === next?.id ? cur : next));
        }
      } catch (e) {
        // The host restarted or retired the session: re-resolve the pin.
        if (e instanceof KleioApiError && e.status === 404) void open(resolve);
      }
    };
    const id = window.setInterval(() => void tick(), running ? POLL_RUNNING_MS : POLL_IDLE_MS);
    return () => window.clearInterval(id);
  }, [session, running, open, resolve]);

  // Each poll replaces the history: only a reader at the newest message is
  // carried along, never one scrolled up to read.
  useEffect(() => {
    catchUp();
  }, [history, running, ask, catchUp]);

  useEffect(() => {
    if (history) onHistory?.(history);
  }, [history, onHistory]);

  async function answerAsk(prompt: AskUserPrompt, answers: AskAnswers): Promise<void> {
    if (!session) return;
    await threadAnswerAsk(session, prompt.id, "answer", answers);
    setAsk((cur) => (cur?.id === prompt.id ? null : cur));
  }

  // Grow the composer with its text, exactly as the Code chat's does.
  useLayoutEffect(() => {
    autosizeComposer(inputRef.current, logRef.current, following());
  }, [draft, following]);

  // A click on a link to one of the agent's files opens it on this Mac.
  const handleLink = useCallback(
    (href: string): boolean => {
      const path = owner ? ownerFilePath(href, owner) : null;
      if (!owner || !path) return false;
      openFile(owner, path).catch((e: unknown) => {
        if (alive.current) setError(fileErrorText(e));
      });
      return true;
    },
    [owner],
  );

  async function send(): Promise<void> {
    const text = draft.trim();
    if (!text || !session || busy) return;
    // A question is waiting: what's typed answers it (the agent's turn is
    // blocked on it), rather than going in as a new message.
    const typed = ask ? typedAnswer(ask, text) : null;
    if (ask && typed) {
      setBusy(true);
      setError(null);
      setDraft("");
      try {
        await answerAsk(ask, typed);
      } catch (e) {
        setError(errorText(e));
        setDraft(text);
      } finally {
        setBusy(false);
      }
      return;
    }
    setBusy(true);
    setError(null);
    setDraft("");
    // Sending means following the reply, wherever the reader had scrolled.
    follow();
    setHistory((h) => [...(h ?? []), { role: "user", text }]);
    try {
      await threadPrompt(session, text);
      setRunning(true);
    } catch (e) {
      setError(errorText(e));
      setDraft(text);
      setHistory((h) => (h ?? []).slice(0, -1));
    } finally {
      setBusy(false);
    }
  }

  const visible = (history ?? []).filter((m) => m.text.trim() || m.compacted);
  const sendDisabled = !session || busy || !draft.trim();

  return (
    <div className="kleio-chat">
      <div
        ref={logRef}
        className="kleio-transcript"
        role="log"
        aria-live="polite"
        aria-label={`Conversation with ${label}`}
        tabIndex={0}
        {...followHandlers}
      >
        <LinkHandlerProvider value={owner ? handleLink : null}>
          <div className="kleio-transcript-inner">
            {history === null && !error && <p className="kleio-chat-hint">Opening…</p>}
            {history !== null &&
              visible.length === 0 &&
              (intro ?? (
                <p className="kleio-chat-hint">
                  Say hello — this conversation is shared with your phone.
                </p>
              ))}
            {visible.map((m, i) =>
              m.compacted ? (
                <p key={i} className="kleio-chat-note">
                  Earlier messages were summarised.
                </p>
              ) : m.role === "user" ? (
                <UserMessage key={i} text={m.text} />
              ) : (
                <AssistantMessage key={i} text={m.text} owner={owner} />
              ),
            )}
            {ask && (
              <ChatAsk
                key={ask.id}
                prompt={ask}
                onSend={(answers) => answerAsk(ask, answers)}
                onTypeInstead={(seed) => {
                  if (seed) setDraft((d) => d + seed);
                  inputRef.current?.focus();
                }}
              />
            )}
            {running && !ask && (
              <div className="assistant-msg kleio-typing" role="status">
                <span className="assistant-dot" style={{ color: theme.primary }} aria-hidden="true">
                  {DOT}
                </span>
                <span className="kleio-typing-dots" aria-label={`${label} is replying`}>
                  <i />
                  <i />
                  <i />
                </span>
              </div>
            )}
          </div>
        </LinkHandlerProvider>
      </div>

      <form
        className="kleio-composer"
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
        <div className="inputwrap">
          <WorkingBeam active={running} />
          <div className="inputrow">
            <div className="input-stack">
              <textarea
                ref={inputRef}
                className="input"
                rows={1}
                value={draft}
                placeholder={`Message ${label}`}
                aria-label={`Message ${label}`}
                disabled={!session}
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
              {phoneComposer && <DictateButton dictation={dictation} disabled={!session} />}
              <WorkingBeam active={running} size="sm" />
              <ActionMetal active={!running && !sendDisabled} windowFocused={windowFocused} />
              {running ? (
                <button
                  type="button"
                  className="icon-circle icon-circle-primary"
                  title="Stop"
                  aria-label="Stop"
                  onClick={() => void threadCancel(session ?? "").catch(() => undefined)}
                >
                  <SquareIcon size={12} weight="fill" aria-hidden="true" />
                </button>
              ) : (
                <button
                  type="submit"
                  className="icon-circle icon-circle-primary"
                  title="Send"
                  aria-label="Send"
                  disabled={sendDisabled}
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
}

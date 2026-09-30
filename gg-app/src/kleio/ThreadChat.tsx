// Compact chat onto a host-pinned conversation (the Kleio home thread, or a
// Blob's chat). Deliberately NOT a GG Chat window: a window owns its sidecar
// session and disposes it on close/switch, which would kill the pinned thread
// every paired device shares. So this view only reads and prompts it — history
// from `/history`, liveness from `/state` (polled; fast while a run is going,
// so replies started from the phone or a schedule show up too), sends via
// `/prompt` — all through the allow-listed, session-scoped `kleio_api` routes.

import { useCallback, useEffect, useRef, useState } from "react";
import type { HistoryEntry } from "../agent";
import { Markdown } from "../Markdown";
import { theme } from "../theme";
import {
  KleioApiError,
  threadCancel,
  threadHistory,
  threadPrompt,
  threadState,
  type ThreadSession,
} from "./kleioApi";

const POLL_RUNNING_MS = 1500;
const POLL_IDLE_MS = 5000;

export function errorText(e: unknown): string {
  if (e instanceof KleioApiError) return e.detail ? `${e.message}: ${e.detail}` : e.message;
  return e instanceof Error ? e.message : String(e);
}

export function ThreadChat({
  label,
  resolve,
  startNew,
}: {
  /** Who you're talking to, e.g. "Kleio" or a Blob's name. */
  label: string;
  /** GET the pinned session (idempotent on the host). */
  resolve: () => Promise<ThreadSession>;
  /** POST …/new: a fresh pinned conversation. */
  startNew: () => Promise<ThreadSession>;
}): React.ReactElement {
  const [session, setSession] = useState<string | null>(null);
  const [history, setHistory] = useState<HistoryEntry[] | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmNew, setConfirmNew] = useState(false);
  const logRef = useRef<HTMLDivElement>(null);
  const alive = useRef(true);
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
    } catch (e) {
      if (alive.current) setError(errorText(e));
    }
  }, []);

  useEffect(() => {
    setSession(null);
    setHistory(null);
    void open(resolve);
  }, [open, resolve]);

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
        if (alive.current) setRunning(now);
      } catch (e) {
        // The host restarted or retired the session: re-resolve the pin.
        if (e instanceof KleioApiError && e.status === 404) void open(resolve);
      }
    };
    const id = window.setInterval(() => void tick(), running ? POLL_RUNNING_MS : POLL_IDLE_MS);
    return () => window.clearInterval(id);
  }, [session, running, open, resolve]);

  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [history, running]);

  async function send(): Promise<void> {
    const text = draft.trim();
    if (!text || !session || busy) return;
    setBusy(true);
    setError(null);
    setDraft("");
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

  async function fresh(): Promise<void> {
    setConfirmNew(false);
    setHistory(null);
    setRunning(false);
    await open(startNew);
  }

  const visible = (history ?? []).filter((m) => m.text.trim() || m.compacted);

  return (
    <div className="kleio-chat">
      <div className="kleio-chat-bar">
        <span className="kleio-chat-who" style={{ color: theme.textMuted }}>
          {running ? `${label} is replying…` : label}
        </span>
        {confirmNew ? (
          <span
            className="kleio-inline-confirm"
            role="group"
            aria-label="Start a new conversation?"
          >
            <span style={{ color: theme.textSecondary }}>Start a new conversation?</span>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => setConfirmNew(false)}
            >
              Cancel
            </button>
            <button type="button" className="btn btn-primary btn-sm" onClick={() => void fresh()}>
              New conversation
            </button>
          </span>
        ) : (
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            disabled={!session}
            onClick={() => setConfirmNew(true)}
            title="Pins a fresh conversation on every device. The old one stays on the host."
          >
            New conversation
          </button>
        )}
      </div>
      <div
        ref={logRef}
        className="kleio-chat-log"
        role="log"
        aria-live="polite"
        aria-label={`Conversation with ${label}`}
        tabIndex={0}
      >
        {history === null && !error && <p className="modal-hint">Opening…</p>}
        {history !== null && visible.length === 0 && (
          <p className="modal-hint">Say hello — this conversation is shared with your phone.</p>
        )}
        {visible.map((m, i) =>
          m.compacted ? (
            <p key={i} className="kleio-chat-note">
              Earlier messages were summarised.
            </p>
          ) : m.role === "user" ? (
            <div key={i} className="kleio-msg kleio-msg-user">
              {m.text}
            </div>
          ) : (
            <div key={i} className="kleio-msg kleio-msg-assistant">
              <Markdown>{m.text}</Markdown>
            </div>
          ),
        )}
        {running && (
          <p className="kleio-chat-note" aria-label={`${label} is replying`}>
            …
          </p>
        )}
      </div>
      {error && (
        <p className="kleio-error" role="alert">
          {error}
        </p>
      )}
      <form
        className="kleio-chat-input"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <textarea
          className="modal-input"
          style={{ color: theme.text, background: theme.inputBackground }}
          rows={2}
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
        {running ? (
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => void threadCancel(session ?? "").catch(() => undefined)}
          >
            Stop
          </button>
        ) : (
          <button
            type="submit"
            className="btn btn-primary btn-sm"
            disabled={!session || busy || !draft.trim()}
          >
            Send
          </button>
        )}
      </form>
    </div>
  );
}

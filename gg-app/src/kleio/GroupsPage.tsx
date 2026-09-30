// Groups: a group chat with several Blobs at once, from the Kleio host.
// Moved out of the Kleio pane into its own page.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { theme } from "../theme";
import { BLOB_COLOR_HEX } from "./blobFormat";
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

function Face({
  emoji,
  color,
  size = 32,
}: {
  emoji: string;
  color: BlobColor;
  size?: number;
}): React.ReactElement {
  return (
    <span
      className="kleio-face"
      aria-hidden="true"
      style={{
        width: size,
        height: size,
        fontSize: size * 0.55,
        background: BLOB_COLOR_HEX[color],
      }}
    >
      {emoji}
    </span>
  );
}

function ErrorLine({ error }: { error: string | null }): React.ReactElement | null {
  return error ? (
    <p className="kleio-error" role="alert">
      {error}
    </p>
  ) : null;
}

export function GroupsPage(): React.ReactElement {
  const [groups, setGroups] = useState<Group[] | null>(null);
  const [blobs, setBlobs] = useState<Blob[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const [editing, setEditing] = useState<Group | "new" | null>(null);
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
  }, [load]);

  if (editing)
    return (
      <GroupForm
        group={editing === "new" ? undefined : editing}
        blobs={blobs}
        onCancel={() => setEditing(null)}
        onSaved={(g) => {
          setEditing(null);
          setOpen(g.id);
          void load();
        }}
        onDeleted={() => {
          setEditing(null);
          setOpen(null);
          void load();
        }}
      />
    );

  const current = groups?.find((g) => g.id === open);
  if (current)
    return (
      <GroupChat
        group={current}
        blobs={blobs}
        onBack={() => {
          setOpen(null);
          void load();
        }}
        onEdit={() => setEditing(current)}
      />
    );

  return (
    <div className="kleio-section">
      <div className="kleio-row-between">
        <p className="modal-hint" style={{ color: theme.textMuted, margin: 0 }}>
          Put Blobs in a room together. @mention one to ask just them.
        </p>
        <button
          type="button"
          className="btn btn-primary btn-sm"
          disabled={blobs.length === 0}
          title={blobs.length === 0 ? "Make a Blob first" : undefined}
          onClick={() => setEditing("new")}
        >
          New group
        </button>
      </div>
      <ErrorLine error={error} />
      {groups === null ? (
        <p className="modal-hint">Loading…</p>
      ) : groups.length === 0 ? (
        <p className="kleio-empty">No group chats yet.</p>
      ) : (
        <ul className="kleio-list">
          {groups.map((g) => (
            <li key={g.id}>
              <button
                type="button"
                className="kleio-list-row kleio-list-button"
                onClick={() => setOpen(g.id)}
              >
                <Face emoji={g.emoji} color={g.color} />
                <span className="kleio-list-main">
                  <span className="kleio-list-title">{g.name}</span>
                  <span className="kleio-list-sub kleio-clamp">
                    {g.typing.length
                      ? "Someone is typing…"
                      : g.lastMessage
                        ? `${g.lastMessage.authorName}: ${g.lastMessage.text}`
                        : `${g.members.length} member${g.members.length === 1 ? "" : "s"}`}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

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
  const [emoji, setEmoji] = useState(group?.emoji ?? "💬");
  const [color, setColor] = useState<BlobColor>(group?.color ?? "lilac");
  const [members, setMembers] = useState<string[]>(group?.members ?? []);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const input = { name: name.trim(), emoji: emoji.trim() || "💬", color, members };
      onSaved(group ? await updateGroup(group.id, input) : await createGroup(input));
    } catch (err) {
      setError(errorText(err));
      setSaving(false);
    }
  }

  return (
    <form className="kleio-form" onSubmit={(e) => void save(e)}>
      <h3 className="kleio-h3">{group ? `Edit ${group.name}` : "New group"}</h3>
      <label className="modal-label" htmlFor="kleio-g-name">
        Name
      </label>
      <input
        id="kleio-g-name"
        className="modal-input"
        value={name}
        maxLength={40}
        onChange={(e) => setName(e.target.value)}
        placeholder="Kitchen crew"
      />
      <div className="kleio-form-row">
        <label className="modal-label" htmlFor="kleio-g-emoji">
          Emoji
        </label>
        <input
          id="kleio-g-emoji"
          className="modal-input kleio-field-emoji"
          value={emoji}
          onChange={(e) => setEmoji([...e.target.value].slice(-1).join("") || "")}
        />
        <span className="kleio-swatches" role="radiogroup" aria-label="Colour">
          {BLOB_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              role="radio"
              aria-checked={color === c}
              aria-label={c}
              className="kleio-swatch"
              style={{ background: BLOB_COLOR_HEX[c] }}
              onClick={() => setColor(c)}
            />
          ))}
        </span>
      </div>
      <span className="modal-label">Members (1–8)</span>
      <div className="kleio-chips" role="group" aria-label="Members">
        {blobs.map((b) => (
          <button
            key={b.id}
            type="button"
            className="kleio-chip"
            aria-pressed={members.includes(b.id)}
            onClick={() =>
              setMembers((cur) =>
                cur.includes(b.id) ? cur.filter((x) => x !== b.id) : [...cur, b.id].slice(0, 8),
              )
            }
          >
            {b.emoji} {b.name}
          </button>
        ))}
      </div>
      <ErrorLine error={error} />
      <div className="modal-actions">
        {group &&
          (confirmDelete ? (
            <span className="kleio-inline-confirm">
              Delete this group?
              <button
                type="button"
                className="btn btn-sm"
                onClick={() =>
                  void deleteGroup(group.id).then(onDeleted, (err) => setError(errorText(err)))
                }
              >
                Delete
              </button>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => setConfirmDelete(false)}
              >
                Keep
              </button>
            </span>
          ) : (
            <button type="button" className="modal-btn" onClick={() => setConfirmDelete(true)}>
              Delete
            </button>
          ))}
        <button type="button" className="modal-btn" onClick={onCancel} disabled={saving}>
          Cancel
        </button>
        <button
          type="submit"
          className="modal-btn primary"
          disabled={saving || !name.trim() || members.length === 0}
        >
          {saving ? "Saving…" : group ? "Save" : "Create"}
        </button>
      </div>
    </form>
  );
}

const GROUP_POLL_MS = 1500;

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
  const [typing, setTyping] = useState<string[]>([]);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const lastSeq = useRef(0);
  const logRef = useRef<HTMLDivElement>(null);
  const byId = useMemo(() => new Map(blobs.map((b) => [b.id, b])), [blobs]);
  const members = group.members.map((id) => byId.get(id)).filter((b): b is Blob => !!b);

  useEffect(() => {
    let live = true;
    lastSeq.current = 0;
    setMessages([]);
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

  async function send(): Promise<void> {
    const text = draft.trim();
    if (!text) return;
    setDraft("");
    try {
      await sendGroupMessage(group.id, text);
    } catch (e) {
      setError(errorText(e));
      setDraft(text);
    }
  }

  const typingNames = typing.map((id) => byId.get(id)?.name ?? "Someone");

  return (
    <div className="kleio-section">
      <div className="kleio-row-between">
        <button type="button" className="btn btn-ghost btn-sm" onClick={onBack}>
          ← All groups
        </button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onEdit}>
          Edit group
        </button>
      </div>
      <div className="kleio-row">
        <Face emoji={group.emoji} color={group.color} size={36} />
        <div>
          <h3 className="kleio-h3" style={{ margin: 0 }}>
            {group.name}
          </h3>
          <span className="kleio-list-sub">{members.map((m) => m.name).join(", ")}</span>
        </div>
      </div>
      <ErrorLine error={error} />
      <div className="kleio-chat-log kleio-group-log" ref={logRef} aria-live="polite">
        {messages.length === 0 && (
          <p className="kleio-empty">Say hello. Everyone replies, or @mention one of them.</p>
        )}
        {messages.map((m) => {
          const mine = m.author === "you";
          const b = byId.get(m.author);
          return (
            <div
              key={m.id}
              className={`kleio-gmsg${mine ? " mine" : ""}`}
              aria-label={`${mine ? "You" : m.authorName} said: ${m.text}`}
            >
              {!mine && <Face emoji={m.emoji} color={b?.color ?? "sky"} size={26} />}
              <div className="kleio-gbubble">
                {!mine && <span className="kleio-gname">{m.authorName}</span>}
                <span className="kleio-gtext">{m.text}</span>
              </div>
            </div>
          );
        })}
        {typingNames.length > 0 && (
          <p className="kleio-typing">{typingNames.join(", ")} is typing…</p>
        )}
      </div>
      <div className="kleio-chips" aria-label="Mention">
        {members.map((m) => (
          <button
            key={m.id}
            type="button"
            className="kleio-chip"
            onClick={() => setDraft((d) => `${d}${d && !d.endsWith(" ") ? " " : ""}@${m.name} `)}
          >
            @{m.name}
          </button>
        ))}
      </div>
      <form
        className="kleio-chat-bar"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <textarea
          className="modal-input kleio-chat-input"
          rows={2}
          value={draft}
          maxLength={4000}
          placeholder={`Message ${group.name}`}
          aria-label={`Message ${group.name}`}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
        />
        <button type="submit" className="btn btn-primary btn-sm" disabled={!draft.trim()}>
          Send
        </button>
      </form>
    </div>
  );
}

// ---------------------------------------------------------------- Apps

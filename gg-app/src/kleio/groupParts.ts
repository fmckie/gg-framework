// What both drawings of Groups share (the iPhone's list and form in
// GroupsPage.tsx, the desktop's in CastGroups.tsx and CastGroupForm.tsx): how a
// group reads in a list, and what its form holds and saves.

import { useState } from "react";
import type { RowState } from "./AgentRow";
import {
  BLOB_COLORS,
  createGroup,
  deleteGroup,
  errorText,
  updateGroup,
  type Blob,
  type BlobColor,
  type Group,
} from "./kleioApi";
import { relTime } from "./relTime";
import { groupMembers, plural } from "./useGroupChat";

/** The host allows 1–8 agents in a group. */
export const MAX_MEMBERS = 8;
export const GROUP_NAME_MAX = 40;
/** Hosts from before agent looks accept only the original six colours. */
const ORIGINAL_COLORS: readonly BlobColor[] = BLOB_COLORS.slice(0, 6);

/** How the host runs a group chat (see kleio-host groups.ts). */
export const HOW_IT_WORKS = [
  "Send a message and the specialist best placed for it starts; others join in as needed.",
  "@mention specialists to choose who replies, in the order you mention them.",
  "Specialists can @mention each other to hand over.",
  "The pen button starts a new conversation; the old one stays on your host.",
];

/** The short state at the right of a group's row, and under it on the shelf. */
export function groupRowState(g: Group, now: number = Date.now()): RowState {
  if (g.typing.length > 0) return { text: "Replying…", tone: "live" };
  // Relative, like the Chats list ("2 h ago").
  if (g.lastMessage) return { text: relTime(g.lastMessage.at, now), tone: "plain" };
  return { text: plural(g.members.length, "member"), tone: "plain" };
}

export function groupRowSub(g: Group): string {
  return g.lastMessage
    ? `${g.lastMessage.authorName}: ${g.lastMessage.text}`
    : "No messages yet — say hello.";
}

export interface GroupFormProps {
  group?: Group;
  blobs: Blob[];
  onSaved: (g: Group) => void;
  onCancel: () => void;
  onDeleted: () => void;
}

/** A group's form: its name, colour and members, and saving or deleting it. */
export function useGroupForm({
  group,
  blobs,
  onSaved,
  onDeleted,
}: Omit<GroupFormProps, "onCancel">) {
  const [name, setName] = useState(group?.name ?? "");
  const [color, setColor] = useState<BlobColor>(group?.color ?? "lilac");
  const [members, setMembers] = useState<string[]>(group?.members ?? []);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // A host that knows agent looks also accepts the larger palette.
  const colors = blobs.some((b) => b.shape !== undefined) ? BLOB_COLORS : ORIGINAL_COLORS;
  const full = members.length >= MAX_MEMBERS;
  const canSave = !saving && Boolean(name.trim()) && members.length > 0;

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
  return {
    name,
    setName,
    color,
    setColor,
    members,
    toggle,
    saving,
    error,
    colors,
    full,
    canSave,
    title: group ? `Edit ${group.name}` : "New group",
    saveLabel: saving ? "Saving…" : group ? "Save" : "Create",
    save,
    remove,
    missing: members.filter((id) => !byId.has(id)),
    chosen: groupMembers({ members }, byId),
  };
}

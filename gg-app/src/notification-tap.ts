// kleio (iPhone): opening what a tapped "agent finished" notification is about.
//
// The host's notification names a session (an agent's run, or a chat or
// project reply) or a group chat. Rust receives the tap from iOS and holds it
// (kleio/phone.rs) until this screen takes it, so a tap that launched the app
// is not lost while the screen loads.

import { useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { error as logError } from "@tauri-apps/plugin-log";
import type { ChatAgentId, WorkspaceMode } from "./agent";
import { isPhone } from "./platform";
import { listBlobs, listGroups } from "./kleio/kleioApi";

/** What the tapped notification named (Rust `NotificationTap`). */
export interface NotificationTap {
  sessionId: string | null;
  groupId: string | null;
}

/** Where a chat lives: enough to reopen it (Rust `parked::ChatTarget`). */
export interface ChatTarget {
  cwd: string;
  sessionPath: string;
  mode: WorkspaceMode;
  chatAgent?: ChatAgentId;
}

export type TapDestination =
  | { kind: "agent"; agentId: string }
  | { kind: "group"; groupId: string }
  | { kind: "chat"; chat: ChatTarget }
  | { kind: "none" };

/** Ways to look a session up; injected so the decision is testable. */
export interface TapLookups {
  /** Whether this group chat still exists. */
  groupExists: (groupId: string) => Promise<boolean>;
  /** The agent (blob) whose chat runs in this session, if any. */
  agentWithSession: (sessionId: string) => Promise<string | null>;
  /** The chat or project this session belongs to, if it can be reopened. */
  chatForSession: (sessionId: string) => Promise<ChatTarget | null>;
}

/**
 * Decide what to open. A group is named outright. A session is an agent's
 * (opened on the Agents page) or a chat's (reopened like picking it from the
 * chat list). If none of them can be found any more, the app just opens.
 * When the host cannot be asked, the named group is still opened: its page
 * shows it once the host answers.
 */
export async function tapDestination(
  tap: NotificationTap,
  lookups: TapLookups,
): Promise<TapDestination> {
  if (tap.groupId) {
    const groupId = tap.groupId;
    const exists = await lookups.groupExists(groupId).catch(() => true);
    return exists ? { kind: "group", groupId } : { kind: "none" };
  }
  if (!tap.sessionId) return { kind: "none" };
  const sessionId = tap.sessionId;
  const agentId = await lookups.agentWithSession(sessionId).catch(() => null);
  if (agentId) return { kind: "agent", agentId };
  const chat = await lookups.chatForSession(sessionId).catch(() => null);
  return chat ? { kind: "chat", chat } : { kind: "none" };
}

/** The real lookups: the host's agent and group lists, and Rust for chats. */
export const hostLookups: TapLookups = {
  groupExists: async (groupId) => {
    const groups = await listGroups();
    return groups.some((g) => g.id === groupId);
  },
  agentWithSession: async (sessionId) => {
    const agents = await listBlobs();
    return agents.find((b) => b.sessionId === sessionId)?.id ?? null;
  },
  chatForSession: (sessionId) => invoke<ChatTarget | null>("kleio_chat_for_session", { sessionId }),
};

/**
 * iPhone: open what a tapped notification is about, on load (a tap that
 * launched the app) and whenever another tap comes in.
 */
export function useNotificationTaps(open: (where: TapDestination) => void): void {
  useEffect(() => {
    if (!isPhone()) return;
    let cancelled = false;
    const takeTap = async (): Promise<void> => {
      try {
        const tap = await invoke<NotificationTap | null>("kleio_take_notification_tap");
        if (!tap) return;
        const where = await tapDestination(tap, hostLookups);
        if (!cancelled) open(where);
      } catch (e) {
        await logError(`kleio: could not open a tapped notification: ${String(e)}`);
      }
    };
    void takeTap();
    const unlisten = listen("kleio-notification-tap", () => void takeTap());
    return () => {
      cancelled = true;
      void unlisten.then((stop) => stop());
    };
  }, [open]);
}

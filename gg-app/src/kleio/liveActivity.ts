// kleio (iPhone): show what an agent is doing on the lock screen and in the
// Dynamic Island. The app starts a Live Activity when you send a message; the
// Kleio host keeps it current by push and ends it when the work is done.
// Chat and Code messages start theirs in Rust (agent_prompt); these are for the
// screens that message the host directly: a specialist's chat and group chats.

import { invoke } from "@tauri-apps/api/core";
import { warn } from "@tauri-apps/plugin-log";
import { isPhone } from "../platform";

export type LiveKind = "specialist" | "group";

/**
 * Show a Live Activity for a conversation (only on the iPhone; elsewhere it
 * does nothing). Never fails the send: a phone with Live Activities turned off
 * just doesn't show one.
 */
export async function startLiveActivity(
  kind: LiveKind,
  title: string,
  ids: { sessionId?: string; groupId?: string },
): Promise<void> {
  if (!isPhone()) return;
  try {
    await invoke("kleio_live_start", {
      kind,
      title,
      sessionId: ids.sessionId ?? null,
      groupId: ids.groupId ?? null,
    });
  } catch (e) {
    void warn(`kleio: could not start a Live Activity: ${String(e)}`);
  }
}

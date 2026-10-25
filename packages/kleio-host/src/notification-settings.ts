/**
 * Whether the host's notifications and Live Activities quote what was said.
 *
 * Apple delivers them, so unlike the link they aren't end-to-end encrypted.
 * By default they quote the start of a reply, a question or an error. With
 * quoting off they still name the conversation and say what happened
 * ("Finished", "Needs your answer"), and a Live Activity still shows its
 * steps, but nothing that was said goes to Apple: no reply, question, error
 * or answer choices. So a question can't be answered from the lock screen
 * then; it's answered in Kleio.
 *
 * The setting is notifications.json in the state folder, read at each push,
 * and an admin device changes it (POST /kleio/notifications). `textlessPusher`
 * wraps the APNs pusher itself, so no push to Apple can miss it.
 */
import { readFile } from "node:fs/promises";
import type { ApnsPusher, LiveActivityAlert, LiveActivityPush, Nudge } from "./apns.js";
import { atomicWrite } from "./device-registry.js";
import { noticeFor, type NoticeKind } from "./notification-copy.js";

export interface NotificationSettings {
  /** Notifications and Live Activities quote what was said. */
  readonly quoteText: boolean;
}

/** Without notifications.json: quoting on, as before the setting. */
export const DEFAULT_NOTIFICATION_SETTINGS: NotificationSettings = { quoteText: true };

/** The setting where it's kept. */
export interface NotificationSettingsStore {
  /** As notifications.json says now. */
  current(): Promise<NotificationSettings>;
  /** Save `next`; every push from now on follows it. */
  set(next: NotificationSettings): Promise<NotificationSettings>;
}

/** `{quoteText: boolean}` and nothing else, as POST /kleio/notifications takes it. */
export function parseNotificationSettings(value: unknown): NotificationSettings | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const keys = Object.keys(value);
  const quoteText: unknown = (value as { quoteText?: unknown }).quoteText;
  if (keys.length !== 1 || typeof quoteText !== "boolean") return null;
  return { quoteText };
}

export function createNotificationSettings(opts: {
  /** notifications.json */
  readonly path: string;
  readonly log: (msg: string) => void;
}): NotificationSettingsStore {
  // Said once, not at every push.
  let warned = false;
  // One write at a time, in the order they were asked for.
  let writing: Promise<unknown> = Promise.resolve();
  return {
    async current() {
      let text: string;
      try {
        text = await readFile(opts.path, "utf8");
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === "ENOENT") return DEFAULT_NOTIFICATION_SETTINGS;
        text = "";
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = null;
      }
      const settings = parseNotificationSettings(parsed);
      if (settings) return settings;
      // The file is there because an admin chose something: when it can't
      // be read, quote nothing rather than guess they wanted quotes.
      if (!warned) {
        warned = true;
        opts.log(
          "[notifications] notifications.json can't be read, so notifications quote nothing until an admin device sets it again",
        );
      }
      return { quoteText: false };
    },
    set(next) {
      const run = writing.then(async () => {
        await atomicWrite(opts.path, `${JSON.stringify({ quoteText: next.quoteText })}\n`, 0o600);
        warned = false;
        return next;
      });
      writing = run.catch(() => undefined);
      return run;
    },
  };
}

/** A notification without its quote: notification-copy.ts then says "Tap to see the result." and the like. */
export function unquotedNudge(nudge: Nudge): Nudge {
  const { text: _text, ...rest } = nudge;
  return rest;
}

/**
 * The Live Activity state's fields that quote what was said: a question or
 * how a group ended (`detail`), the result (`summary`), and the answer
 * buttons with their key.
 */
const QUOTING_FIELDS: ReadonlySet<string> = new Set([
  "detail",
  "summary",
  "options",
  "askId",
  "askKey",
  "recommended",
]);

/** Which notice a Live Activity alert stands for, by its phase. */
const PHASE_KIND: Readonly<Record<string, NoticeKind>> = {
  needsYou: "question",
  done: "finished",
  failed: "failed",
  stopped: "stopped",
};

/**
 * A Live Activity push without what was said: the state keeps its phase,
 * line and steps, and an alert keeps its title (the conversation's name) with
 * a body that says only what to do, such as "Tap to answer."
 */
export function unquotedLivePush(push: LiveActivityPush): LiveActivityPush {
  const contentState = Object.fromEntries(
    Object.entries(push.contentState).filter(([field]) => !QUOTING_FIELDS.has(field)),
  );
  const phase = push.contentState.phase;
  const kind = (typeof phase === "string" ? PHASE_KIND[phase] : undefined) ?? "message";
  const alert: LiveActivityAlert | undefined = push.alert
    ? { ...push.alert, body: noticeFor({ kind }).body }
    : undefined;
  return { ...push, contentState, ...(alert ? { alert } : {}) };
}

/**
 * `inner`, with each notification and Live Activity push checked against
 * `settings` as it goes: with quoting off, what was said is left out. A new
 * pairing's alert names only the device and the host, so it's unchanged.
 */
export function textlessPusher(
  inner: ApnsPusher,
  settings: Pick<NotificationSettingsStore, "current">,
): ApnsPusher {
  const quoting = async (): Promise<boolean> => (await settings.current()).quoteText;
  return {
    configured: inner.configured,
    ...(inner.env !== undefined ? { env: inner.env } : {}),
    async notify(nudge, devices) {
      return inner.notify((await quoting()) ? nudge : unquotedNudge(nudge), devices);
    },
    pairing: (alert, devices) => inner.pairing(alert, devices),
    async liveActivity(target, push) {
      return inner.liveActivity(target, (await quoting()) ? push : unquotedLivePush(push));
    },
  };
}

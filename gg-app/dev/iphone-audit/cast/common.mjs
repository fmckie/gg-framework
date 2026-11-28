// Shared helpers for the cast audit scenes (throwaway).
import { base } from "../lib.mjs";

export const cast = base.cast;
export const NOW = cast.CAST_NOW;
export const AREA = "cast";

const ok = (body) => ({ status: 200, body });

/** Extra host routes the Cast screens read, over base.defaultApi. `extra`:
 *   history   { [sessionId]: HistoryEntry[] }
 *   running   Set of sessionIds whose thread is running
 *   room      { group, blobs, page } from castGroup(n): answers that group's messages
 */
export function makeApi(extra = {}) {
  return ({ method, path, session }, { data }) => {
    const p = path.split("?")[0];
    const get = method === "GET";
    // A pinned thread's sidecar session.
    if (p === "/state") {
      const running = Boolean(session && extra.running?.has(session));
      return ok({ ...base.state, running, runState: running ? "running" : "idle", pendingAsks: [] });
    }
    if (p === "/history") return ok({ history: (session && extra.history?.[session]) ?? [] });
    if (p === "/prompt" || p === "/cancel") return ok({ ok: true });
    if (p === "/memories") return ok({ memories: [] });
    // Groups.
    const g = /^\/kleio\/groups\/([^/]+)(\/.*)?$/.exec(p);
    if (g) {
      const id = decodeURIComponent(g[1]);
      const rest = g[2] ?? "";
      const group = data.groups.find((x) => x.id === id);
      if (get && rest === "/messages") {
        if (extra.room && extra.room.group.id === id) {
          const after = Number(new URLSearchParams(path.split("?")[1] ?? "").get("after") ?? 0);
          const page = extra.room.page;
          return ok({ ...page, messages: page.messages.filter((m) => m.seq > after) });
        }
        const last = group?.lastMessage;
        return ok({ messages: last ? [last] : [], typing: group?.typing ?? [], lastSeq: last ? 1 : 0, activity: {}, outcomes: {} });
      }
      if (method === "POST" && rest === "/stop") return ok({ ok: true });
      if (method === "POST" && rest === "/messages") return ok({ message: { seq: 99, id: "m99", author: "you", authorName: "You", emoji: "", text: "ok", at: NOW.toISOString() } });
      if (get && rest === "" && group) return ok({ group });
    }
    // A blob's schedules (answered, changing nothing).
    const s = /^\/kleio\/blobs\/([^/]+)\/schedules(\/.*)?$/.exec(p);
    if (s) {
      const blob = data.blobs.find((b) => b.id === decodeURIComponent(s[1]));
      const first = blob?.schedules?.[0];
      if (/\/run$/.test(p)) return ok({ run: { id: "r-now", blobId: blob?.id, scheduleId: first?.id ?? null, label: first?.label ?? "Run", startedAt: NOW.toISOString(), outcome: "ok" } });
      return ok({ schedule: first ?? null });
    }
    const m = /^\/kleio\/blobs\/([^/]+)\/messages$/.exec(p);
    if (get && m) return ok({ messages: [] });
    if (get && p === "/kleio/connections/toolkits") return ok({ toolkits: extra.toolkits ?? [], nextCursor: null });
    if (get && p === "/kleio/files") return ok({ files: [] });
    return undefined;
  };
}

/** Home → Specialists (the Cast's first tab). */
export async function openCast(app) {
  await app.tap(app.page.locator("button.home-action", { hasText: "Specialists" }).first(), { settle: 900 });
}

/** The Specialists / Groups switcher's tab. */
export async function switchTab(app, label) {
  await app.tap(app.page.getByRole("tab", { name: label }).first(), { settle: 900 });
}

/** Computed font-size of every visible input/textarea/select: [{ el, px, name }]. */
export async function inputSizes(app) {
  return app.page.evaluate(() =>
    [...document.querySelectorAll("input, textarea, select")]
      .filter((el) => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0 && !el.closest("[inert]") && el.type !== "checkbox" && el.type !== "radio" && el.type !== "hidden";
      })
      .map((el) => ({
        el: `${el.tagName.toLowerCase()}${el.className ? "." + String(el.className).trim().split(/\s+/).join(".") : ""}`,
        name: el.getAttribute("aria-label") || el.getAttribute("placeholder") || el.id || "",
        px: parseFloat(getComputedStyle(el).fontSize),
        w: Math.round(el.getBoundingClientRect().width),
        h: Math.round(el.getBoundingClientRect().height),
      })),
  );
}

/** Print inputs under 16px on the phone. */
export async function reportInputs(app, screen) {
  const list = await inputSizes(app);
  const small = list.filter((x) => x.px < 16);
  console.log(`\n-- ${screen} (${app.device}) inputs: ${list.map((x) => `${x.el} "${x.name}" ${x.px}px ${x.w}x${x.h}`).join(" | ") || "none"}`);
  if (app.isPhone && small.length) console.log(`   UNDER 16px: ${small.map((x) => `${x.el} ${x.px}px`).join(", ")}`);
  return list;
}

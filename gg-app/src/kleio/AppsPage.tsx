// Apps: the services Kleio and every Blob can use for you (Gmail, Calendar,
// Notion…), through Composio on the Mac mini. Sign-in happens in the browser,
// and the page notices when it's done.
//
// This file loads, searches, connects and disconnects; the markup is the shelf
// (AppsShelf.tsx).
//
// Logos come from Composio's logo CDN, addressed by the app's slug — never
// from the catalogue's free-form logo links, which can point anywhere. The
// app's content security policy allows images from that one origin only.

import { useCallback, useEffect, useRef, useState } from "react";
import { openUrl } from "../agent";
import { Badge } from "../Badge";
import { SettingsHeaderStatus } from "../settings-header";
import { theme } from "../theme";
import {
  connectToolkit,
  disconnect,
  listConnections,
  listToolkits,
  errorText,
  getSetupStatus,
  KleioApiError,
  removeSetupKey,
  type Connection,
  type SetupStatus,
  type Toolkit,
} from "./kleioApi";
import { connectionState, type ConnectionState } from "./connectionState";
import { AppsShelf } from "./AppsShelf";
import { takeSettingsIntent } from "./settingsIntent";

/** The one image origin the CSP allows (src-tauri/tauri.conf.json). */
export const LOGO_ORIGIN = "https://logos.composio.dev";
/** Where an app's own developer keys are added (Composio's auth configs). */
export const COMPOSIO_AUTH_CONFIGS_URL = "https://dashboard.composio.dev/~/project/auth-configs";

/** What went wrong with an app, in words. Older hosts pass Composio's raw
 *  JSON as the detail; its own message is the readable part. */
export function appErrorText(e: unknown): string {
  if (!(e instanceof KleioApiError) || e.message !== "composio") return errorText(e);
  let detail = e.detail?.trim() ?? "";
  if (detail.startsWith("{")) {
    try {
      const err = (JSON.parse(detail) as { error?: { message?: unknown } }).error;
      if (typeof err?.message === "string") detail = err.message;
    } catch {
      // Not JSON after all: show it as it came.
    }
  }
  if (/does not require authentication/i.test(detail))
    return "This app doesn't need a sign-in. Kleio and your specialists can already use it.";
  if (/does not manage auth/i.test(detail))
    return "Composio has no ready-made sign-in for this app. Add your own developer keys for it in Composio, then connect again.";
  return detail ? `Composio couldn't do that: ${detail}` : "Composio couldn't do that.";
}

/** A failed connect that only your own keys in Composio can fix. */
function needsSetup(e: unknown): boolean {
  if (!(e instanceof KleioApiError)) return false;
  return e.code === "needs_setup" || /does not manage auth/i.test(e.detail ?? "");
}

/** A connect refused because the app needs no sign-in at all. */
function needsNoSignIn(e: unknown): boolean {
  if (!(e instanceof KleioApiError)) return false;
  return e.code === "no_auth" || /does not require authentication/i.test(e.detail ?? "");
}
const SLUG = /^[a-z0-9][a-z0-9_-]{0,63}$/i;
const SEARCH_DEBOUNCE_MS = 300;
/** While a sign-in is open in the browser, check back this often. */
const PENDING_POLL_MS = 4_000;

/** Composio's logo for an app, or null for a slug that isn't one. */
export function logoUrl(slug: string): string | null {
  return SLUG.test(slug) ? `${LOGO_ORIGIN}/api/${slug.toLowerCase()}` : null;
}

// In its own file so Overview can read an app's state without loading this page.
export { connectionState, type ConnectionState };

const ACRONYMS = new Set(["ai", "api", "ats", "cms", "crm", "erp", "hr", "it", "seo", "sms"]);

/**
 * An app's first category in sentence case, acronyms kept whole:
 * "developer tools" → "Developer tools", "ai" → "AI".
 */
export function categoryLabel(categories: readonly string[]): string | null {
  const words = (categories[0] ?? "").trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return null;
  return words
    .map((w, i) =>
      ACRONYMS.has(w) ? w.toUpperCase() : i === 0 ? w.charAt(0).toUpperCase() + w.slice(1) : w,
    )
    .join(" ");
}

export function AppsPage(): React.ReactElement {
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [connections, setConnections] = useState<Connection[]>([]);
  const [search, setSearch] = useState("");
  const [toolkits, setToolkits] = useState<Toolkit[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [pending, setPending] = useState<string | null>(null);
  /** The last thing that went wrong. `list`: the host couldn't be asked for your apps. */
  const [error, setError] = useState<{ text: string; list: boolean } | null>(null);
  /** The last connect needs the user's own keys in Composio: offer the way there. */
  const [setupFor, setSetupFor] = useState<string | null>(null);
  /** Apps found to need no sign-in after a connect was refused (older hosts). */
  const [noSignIn, setNoSignIn] = useState<ReadonlySet<string>>(new Set());
  const query = useRef("");
  // Who may change the Composio key, and where it is kept. Null until the host
  // says, and for an older host that can't: as before then.
  const [keys, setKeys] = useState<SetupStatus | null>(null);
  const loadKeys = useCallback(async (): Promise<void> => {
    try {
      setKeys(await getSetupStatus());
    } catch {
      setKeys(null);
    }
  }, []);
  useEffect(() => void loadKeys(), [loadKeys]);

  const load = useCallback(async (): Promise<void> => {
    try {
      const r = await listConnections();
      setConfigured(r.configured);
      setConnections(r.connections);
      setError(null);
    } catch (e) {
      setError({ text: errorText(e), list: true });
    }
  }, []);

  useEffect(() => {
    void load();
    // Back from the browser's sign-in: refresh when the window regains focus,
    // or is on screen again (the iPhone, coming back from Safari).
    const again = (): void => {
      if (document.visibilityState !== "hidden") void load();
    };
    window.addEventListener("focus", again);
    document.addEventListener("visibilitychange", again);
    return () => {
      window.removeEventListener("focus", again);
      document.removeEventListener("visibilitychange", again);
    };
  }, [load]);

  const waiting = connections.some((c) => connectionState(c.status) === "pending");
  useEffect(() => {
    if (!waiting) return;
    const id = window.setInterval(() => void load(), PENDING_POLL_MS);
    return () => window.clearInterval(id);
  }, [waiting, load]);

  useEffect(() => {
    if (!configured) return;
    let live = true;
    const text = search.trim();
    const t = window.setTimeout(() => {
      query.current = text;
      setToolkits(null);
      listToolkits(text ? { search: text } : {})
        .then((p) => {
          if (!live) return;
          setToolkits(p.toolkits);
          setCursor(p.nextCursor);
        })
        .catch((e: unknown) => live && setError({ text: errorText(e), list: false }));
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      live = false;
      window.clearTimeout(t);
    };
  }, [configured, search]);

  async function more(): Promise<void> {
    if (!cursor || loadingMore) return;
    setLoadingMore(true);
    const asked = query.current;
    try {
      const p = await listToolkits({ ...(asked ? { search: asked } : {}), cursor });
      // A new search started meanwhile: its results win.
      if (asked !== query.current) return;
      setToolkits((cur) => {
        const seen = new Set((cur ?? []).map((t) => t.slug));
        return [...(cur ?? []), ...p.toolkits.filter((t) => !seen.has(t.slug))];
      });
      setCursor(p.nextCursor);
    } catch (e) {
      setError({ text: errorText(e), list: false });
    } finally {
      setLoadingMore(false);
    }
  }

  async function connect(slug: string): Promise<void> {
    setPending(slug);
    setError(null);
    setSetupFor(null);
    try {
      const r = await connectToolkit(slug);
      await openUrl(r.redirectUrl);
      await load();
    } catch (e) {
      if (needsNoSignIn(e)) {
        // Nothing to connect: show the app as ready instead of an error.
        setNoSignIn((s) => new Set(s).add(slug));
      } else {
        setError({ text: appErrorText(e), list: false });
        if (needsSetup(e)) setSetupFor(slug);
      }
    } finally {
      setPending(null);
    }
  }

  // What Overview's Fix asked this page for, if it did: read once.
  const [toReconnect] = useState(() => takeSettingsIntent() === "apps-fix");
  const connected = connections.filter((c) => connectionState(c.status) === "connected");
  return (
    <>
      <SettingsHeaderStatus>
        {configured === true && (
          <Badge color={connected.length > 0 ? theme.success : undefined}>
            {`${connected.length} connected`}
          </Badge>
        )}
      </SettingsHeaderStatus>
      <AppsShelf
        words={{ logoUrl, categoryLabel, authConfigsUrl: COMPOSIO_AUTH_CONFIGS_URL }}
        configured={configured}
        connections={connections}
        listFailed={error?.list === true}
        error={error && !error.list ? error.text : null}
        needsOwnKeys={setupFor !== null}
        search={search}
        onSearch={setSearch}
        toolkits={toolkits}
        hasMore={cursor !== null}
        loadingMore={loadingMore}
        onMore={() => void more()}
        pending={pending}
        noSignIn={noSignIn}
        keys={keys}
        focusReconnect={toReconnect}
        onConnect={(slug) => void connect(slug)}
        onRetry={() => void load()}
        onDisconnect={async (c) => {
          await disconnect(c.id);
          await load();
        }}
        onKeySaved={(status) => {
          setKeys(status);
          void load();
        }}
        onRemoveKey={async () => {
          setKeys(await removeSetupKey("composio"));
          await load();
        }}
      />
    </>
  );
}

// Settings → Apps, on the desktop: the shelf. Every connection stands on one
// hairline with its state in a line; the apps not connected wait in a quiet
// list under "Add an app"; Disconnect waits in the Remove group, with the
// Composio key last. AppsPage.tsx does the loading, searching, connecting and
// disconnecting, and the phone keeps its own page there.

import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import {
  ArrowClockwiseIcon,
  ArrowSquareOutIcon,
  CheckCircleIcon,
  MagnifyingGlassIcon,
} from "@phosphor-icons/react";
import { openUrl } from "../agent";
import { connectionState, type ConnectionState } from "./connectionState";
import { KeyForm, setupKeyError } from "./KeyForm";
import { errorText, type Connection, type SetupStatus, type Toolkit } from "./kleioApi";
import { relTime } from "./relTime";
import { RemoveGroup, RemoveItem } from "./RemoveGroup";

/** Composio's logo address for an app, and how its category reads (AppsPage.tsx). */
export interface AppWords {
  logoUrl: (slug: string) => string | null;
  categoryLabel: (categories: readonly string[]) => string | null;
  authConfigsUrl: string;
}

/** Empty places on the shelf: before Composio, before the first app, or while the host is silent. */
const PLACES = 3;

/**
 * A connection's line on the shelf: its state and, once connected, since when
 * ("Connected 21 d ago"). "Connected" alone when the host sent no date.
 */
export function connectionLine(c: Connection, now: number = Date.now()): string {
  switch (connectionState(c.status)) {
    case "connected": {
      const at = Date.parse(c.createdAt);
      if (Number.isNaN(at)) return "Connected";
      // A minute old, or a clock ahead of this one.
      return now - at < 60_000 ? "Connected just now" : `Connected ${relTime(c.createdAt, now)}`;
    }
    case "pending":
      return "Finish signing in, in your browser";
    case "expired":
      return "Sign-in expired";
    case "failed":
      return "Didn't connect";
    case "other":
      return c.status.toLowerCase();
  }
}

/**
 * An app's logo in a tile, with its state on the rim. The tile turns light
 * only once the image has loaded, so a dark mark stays legible; until then,
 * and when there is no image, it is a hairline around the app's first letter.
 */
function AppIcon({
  src,
  name,
  size,
  state,
}: {
  src: string | null;
  name: string;
  size: number;
  state?: ConnectionState;
}): React.ReactElement {
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const img = useRef<HTMLImageElement>(null);
  // An image already in the cache can finish before its load is listened for.
  useLayoutEffect(() => {
    if (img.current?.complete && img.current.naturalWidth > 0) setLoaded(true);
  }, []);
  const asked = src !== null && !failed;
  const shown = asked && loaded;
  return (
    <span
      className={`ap-icon${shown ? " has-logo" : ""}`}
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      {asked && (
        <img
          ref={img}
          src={src}
          alt=""
          width={Math.round(size * 0.6)}
          height={Math.round(size * 0.6)}
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          onLoad={() => setLoaded(true)}
          onError={() => setFailed(true)}
        />
      )}
      {!shown && (
        <span className="ap-icon-letter">{name.trim().charAt(0).toUpperCase() || "?"}</span>
      )}
      {state && <span className={`ap-dot is-${state}`} />}
    </span>
  );
}

export function AppsShelf({
  words,
  configured,
  connections,
  listFailed,
  error,
  needsOwnKeys,
  search,
  onSearch,
  toolkits,
  hasMore,
  loadingMore,
  onMore,
  pending,
  noSignIn,
  keys,
  focusReconnect,
  onConnect,
  onRetry,
  onDisconnect,
  onKeySaved,
  onRemoveKey,
}: {
  words: AppWords;
  /** Whether the host has a Composio key; null until it says. */
  configured: boolean | null;
  connections: Connection[];
  /** The host couldn't be asked for your apps the last time. */
  listFailed: boolean;
  /** Why the last connect, search or page didn't work. */
  error: string | null;
  /** That connect needs your own keys in Composio. */
  needsOwnKeys: boolean;
  search: string;
  onSearch: (text: string) => void;
  /** The catalogue's page; null while it loads. */
  toolkits: Toolkit[] | null;
  hasMore: boolean;
  loadingMore: boolean;
  onMore: () => void;
  /** The app being connected. */
  pending: string | null;
  noSignIn: ReadonlySet<string>;
  keys: SetupStatus | null;
  /** Overview's Fix asked for the first app to reconnect. */
  focusReconnect: boolean;
  onConnect: (slug: string) => void;
  onRetry: () => void;
  /** Throws when it couldn't. */
  onDisconnect: (c: Connection) => Promise<void>;
  onKeySaved: (status: SetupStatus) => void;
  /** Throws when it couldn't. */
  onRemoveKey: () => Promise<void>;
}): React.ReactElement {
  const addId = useId();
  const shelf = useRef<HTMLDivElement>(null);
  const wrap = useRef<HTMLElement>(null);
  // How many apps one line of the shelf holds: each line is its own row, so
  // each has its own hairline under its icons, however tall its words run.
  const [perRow, setPerRow] = useState<number | null>(null);
  useLayoutEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const read = (): void => {
      const item = parseFloat(getComputedStyle(el).getPropertyValue("--ap-item"));
      setPerRow(
        item > 0 && el.clientWidth > 0 ? Math.max(1, Math.floor(el.clientWidth / item)) : null,
      );
    };
    read();
    if (typeof ResizeObserver === "undefined") return;
    const watch = new ResizeObserver(read);
    watch.observe(el);
    return () => watch.disconnect();
  }, []);
  const addTitle = useRef<HTMLHeadingElement>(null);
  const disconnects = useRef<HTMLDivElement>(null);

  // What Overview's Fix asked for: the first Reconnect, focused and not pressed
  // (pressing it opens the browser). Once, when the list is first in.
  const landed = useRef(false);
  useEffect(() => {
    if (!focusReconnect || landed.current || configured === null) return;
    landed.current = true;
    const first = shelf.current?.querySelector<HTMLButtonElement>(".ap-inline-btn");
    first?.scrollIntoView?.({ block: "nearest" });
    first?.focus();
  }, [focusReconnect, configured, connections]);

  // After a disconnect, focus goes to the next app's item; with none, to Add an app.
  const [disconnectedAt, setDisconnectedAt] = useState<number | null>(null);
  useEffect(() => {
    if (disconnectedAt === null) return;
    const next = disconnects.current?.children[disconnectedAt]?.querySelector("button");
    if (next) next.focus();
    else addTitle.current?.focus();
    setDisconnectedAt(null);
  }, [disconnectedAt]);

  const silent = configured === null && listFailed;
  const taken = new Set(connections.map((c) => c.toolkit));
  // An app is in one place only: on the shelf, or here.
  const unconnected = (toolkits ?? []).filter((t) => !taken.has(t.slug));
  const canRemoveKey =
    configured === true && keys?.admin === true && keys.keys.composio === "saved";
  const rows: Connection[][] = [];
  const size = perRow ?? Math.max(1, connections.length);
  for (let i = 0; i < connections.length; i += size) rows.push(connections.slice(i, i + size));

  return (
    <div className="ap-page">
      <section className="ap-shelf-wrap" aria-label="Your apps" ref={wrap}>
        {connections.length > 0 ? (
          <div className="ap-shelf" role="list" ref={shelf}>
            {rows.map((row) => (
              <div key={row[0]?.id} className="ap-shelf-row" role="presentation">
                {row.map((c) => {
                  const state = connectionState(c.status);
                  return (
                    <div
                      key={c.id}
                      role="listitem"
                      className={`ap-item is-${state}`}
                      data-app={c.toolkit}
                    >
                      <AppIcon
                        src={words.logoUrl(c.toolkit)}
                        name={c.name}
                        size={56}
                        state={state}
                      />
                      <span className="ap-name">{c.name}</span>
                      <span className="ap-line">
                        {connectionLine(c)}
                        {(state === "expired" || state === "failed") && (
                          <button
                            type="button"
                            className="ap-inline-btn"
                            aria-label={`Reconnect ${c.name}`}
                            disabled={pending !== null}
                            onClick={() => onConnect(c.toolkit)}
                          >
                            Reconnect
                          </button>
                        )}
                      </span>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        ) : (
          <div className="ap-shelf is-empty" aria-hidden="true">
            <div className="ap-shelf-row">
              {Array.from({ length: PLACES }, (_, i) => (
                <span key={i} className="ap-slot" />
              ))}
            </div>
          </div>
        )}
        {silent ? (
          <p className="ap-shelf-line" role="status">
            Couldn't reach your host to list your apps.
            <button type="button" className="st-text-btn" onClick={onRetry}>
              <ArrowClockwiseIcon size={12} weight="bold" aria-hidden="true" />
              Try again
            </button>
          </p>
        ) : configured === false ? (
          <>
            <p className="ap-shelf-line">Your apps go here once Composio is set up.</p>
            <p className="ap-caption">
              Gmail, Calendar, Notion and hundreds more can then work for Kleio and every
              specialist, through Composio on your host.
            </p>
          </>
        ) : configured === null ? null : connections.length === 0 ? (
          <p className="ap-shelf-line">Nothing connected yet. Pick an app below to start.</p>
        ) : (
          <p className="ap-caption">
            Kleio and every specialist can use these now. You signed in once, in your browser.
          </p>
        )}
        {/* A later read that failed: what was there stays, and this says it may be stale. */}
        {listFailed && !silent && (
          <p className="ap-notice" role="status">
            <span>Couldn't reach your host to refresh your apps.</span>
            <button type="button" className="st-text-btn" onClick={onRetry}>
              <ArrowClockwiseIcon size={12} weight="bold" aria-hidden="true" />
              Try again
            </button>
          </p>
        )}
      </section>

      {error && (
        <div className="ap-error" role="alert">
          <span>{error}</span>
          {needsOwnKeys && (
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => void openUrl(words.authConfigsUrl)}
            >
              <ArrowSquareOutIcon size={14} weight="bold" aria-hidden="true" />
              Open Composio
            </button>
          )}
        </div>
      )}

      {configured === false ? (
        <section className="ap-setup">
          {keys && !keys.admin ? (
            <p className="ap-setup-note">Only your admin device can add the key.</p>
          ) : (
            <KeyForm name="composio" onSaved={onKeySaved} />
          )}
        </section>
      ) : (
        <section className="ap-add" aria-labelledby={addId}>
          <h2 className="st-label" id={addId} ref={addTitle} tabIndex={-1}>
            Add an app
          </h2>
          <label className="ap-search">
            <MagnifyingGlassIcon size={15} weight="bold" aria-hidden="true" />
            <input
              className="ap-search-input"
              type="search"
              placeholder="Search Gmail, Notion, Calendar…"
              value={search}
              onChange={(e) => onSearch(e.target.value)}
              aria-label="Search apps"
              spellCheck={false}
              // Nothing to search until the host answers.
              disabled={silent}
            />
          </label>
          <p className="ap-add-note">Search hundreds of apps. Connecting opens your browser.</p>

          {configured === null ? (
            <p className="ap-add-empty">
              {silent ? "Apps load when your host answers." : "Loading apps…"}
            </p>
          ) : toolkits === null ? (
            <p className="ap-add-empty">Loading apps…</p>
          ) : (
            <>
              {unconnected.length === 0 ? (
                <p className="ap-add-empty">
                  {search.trim()
                    ? `No apps match “${search.trim()}”.`
                    : "Every app here is connected."}
                </p>
              ) : (
                <ul className="ap-add-list">
                  {unconnected.map((t) => {
                    const cat = words.categoryLabel(t.categories);
                    const ready = t.auth === "none" || noSignIn.has(t.slug);
                    const head = (
                      <>
                        <AppIcon src={words.logoUrl(t.slug)} name={t.name} size={30} />
                        <span className="ap-add-text">
                          <span className="ap-add-name">{t.name}</span>
                          {cat && <span className="ap-add-cat">{cat}</span>}
                        </span>
                      </>
                    );
                    return (
                      <li key={t.slug} data-app={t.slug}>
                        {ready ? (
                          <span
                            className="ap-add-row is-ready"
                            title="Kleio and your specialists can use it without signing in."
                          >
                            {head}
                            <span className="ap-add-how is-ready">
                              <CheckCircleIcon size={13} weight="fill" aria-hidden="true" />
                              Ready · no sign-in
                            </span>
                          </span>
                        ) : (
                          <button
                            type="button"
                            className="ap-add-row"
                            disabled={pending !== null}
                            onClick={() => onConnect(t.slug)}
                            aria-label={`Connect ${t.name}`}
                            // What the app does, on hover: the list stays one line a row.
                            title={t.description.trim() || undefined}
                          >
                            {head}
                            <span className="ap-add-how">
                              {pending === t.slug
                                ? "Opening…"
                                : t.auth === "setup"
                                  ? "Needs your own keys"
                                  : "Connect"}
                            </span>
                          </button>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
              {hasMore && (
                <div className="ap-more">
                  <button
                    type="button"
                    className="st-text-btn"
                    onClick={onMore}
                    disabled={loadingMore}
                  >
                    {loadingMore ? "Loading…" : "Show more apps"}
                  </button>
                </div>
              )}
            </>
          )}
        </section>
      )}

      {configured !== false && keys?.keys.composio === "env" && (
        <p className="app-key-note">
          <span className="app-key-note-label">Composio key</span>
          Set on the host itself, so it can't be changed here.
        </p>
      )}
      {configured !== false && (connections.length > 0 || canRemoveKey) && (
        <RemoveGroup>
          <div ref={disconnects}>
            {connections.map((c, i) => (
              <RemoveItem
                key={c.id}
                // Its line too, so two connections of one app can be told apart.
                what={`${c.name} · ${connectionLine(c)}`}
                ask="Disconnect"
                label={`Disconnect ${c.name}`}
                confirm="Disconnect"
                busyText="Disconnecting…"
                hint={`Kleio and your specialists lose ${c.name} until you connect it again.`}
                onRemove={async () => {
                  await onDisconnect(c);
                  setDisconnectedAt(i);
                }}
                describeError={errorText}
              />
            ))}
          </div>
          {canRemoveKey && (
            <RemoveItem
              what="Composio key, saved on your host"
              ask="Remove Composio key"
              confirm="Remove Composio key"
              busyText="Removing…"
              hint="Kleio and your specialists can't use your apps until a key is added again."
              onRemove={onRemoveKey}
              describeError={(e) => setupKeyError("composio", e)}
            />
          )}
        </RemoveGroup>
      )}
    </div>
  );
}

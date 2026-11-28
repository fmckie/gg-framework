// Settings → Tools: the workbench. One row per MCP server, its
// tools drawn as ticks on one shared scale; a server that needs something has
// Sign in or Fix on its row; Add sits beside its field and Remove ends the page.
// A row shows a server's kind and a short form only (its host, or its program's
// name): the whole command or address can hold a key, so it is the name's
// tooltip and appears in Fix's step once Fix is pressed. McpModal is still
// upstream's dialog, so its loading is repeated here.

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { ArrowClockwiseIcon } from "@phosphor-icons/react";
import {
  addMcpServer,
  listMcpServers,
  listProjects,
  loginMcpServer,
  openUrl,
  removeMcpServer,
  subscribe,
  type DiscoveredProject,
  type McpServerRow,
  type SidecarEvent,
} from "../agent";
import { mcpRowNoteLines } from "../placeholder/McpRowNotes";
import { toast } from "../toast";
import { FixStepText } from "./FixSteps";
import { RemoveGroup, RemoveItem } from "./RemoveGroup";
import { takeSettingsIntent } from "./settingsIntent";

type Scope = "global" | "project";

/** Most ticks drawn for one server; the rest are counted ("+292"). */
export const MAX_TICKS = 120;
/** A server that didn't load reports no tools: its track is a dim stub. */
const STUB_TICKS = 4;
/** One tick's width on the track and the ruler, in px. */
const PITCH = 10;
/** Room kept beside the ticks for the count. */
const COUNT_ROOM = 56;

const toolWords = (n: number): string => `${n} tool${n === 1 ? "" : "s"}`;
const rowKey = (s: McpServerRow): string => `${s.scope}:${s.name}`;

/**
 * A server's kind and where it runs, without anything that could hold a key:
 * an address's host, or a command's program name. The kind alone when neither
 * can be read.
 */
export function serverShortForm(server: Pick<McpServerRow, "kind" | "summary">): string {
  const summary = server.summary.trim();
  let short = "";
  if (server.kind === "http") {
    try {
      // `host` leaves out the path, the query and any sign-in part.
      short = new URL(summary).host;
    } catch {
      short = "";
    }
  } else {
    const program = (summary.split(/\s+/)[0] ?? "").split(/[\\/]/).pop() ?? "";
    // Only a plain program name: anything stranger could be a key.
    if (/^[\w.@+-]{1,40}$/.test(program)) short = program;
  }
  return short ? `${server.kind} · ${short}` : server.kind;
}

/**
 * A server Kleio chose not to start, and why: a project's server while the
 * project isn't trusted, or a package the guard flagged. Running its command
 * by hand is exactly what not to suggest, so these rows get no Fix. Recognised
 * by the sidecar's own wording (mcp-rows.ts, client.ts); anything else is an
 * ordinary failure.
 */
export function heldBack(server: McpServerRow): { why: string; next: string } | null {
  if (server.ok || server.requiresAuth || !server.error) return null;
  const first = server.error.split("\n")[0] ?? "";
  if (/^Project-scope server not connected\b/.test(first))
    return {
      why: "Not started. This project's servers aren't trusted yet.",
      next: "If you trust this project, add one of its servers again below, with Project chosen.",
    };
  // `MCP server "name" not started. Blocked install (rule): why`
  const blocked = /(?:^|\bnot started\. )(Blocked\b.*)$/.exec(first);
  if (blocked?.[1])
    return { why: blocked[1], next: "Remove it under Remove unless you're sure of it." };
  return null;
}

type RowState = "ok" | "auth" | "held" | "failed";

function rowState(server: McpServerRow): RowState {
  if (server.ok) return "ok";
  if (server.requiresAuth) return "auth";
  return heldBack(server) ? "held" : "failed";
}

const STATE_WORDS: Record<Exclude<RowState, "ok">, string> = {
  auth: "needs sign-in",
  held: "held back",
  failed: "failed",
};

export function ToolsPage(): React.ReactElement {
  const [servers, setServers] = useState<McpServerRow[]>([]);
  const [loading, setLoading] = useState(true);
  // False until the first list is in: what Overview asked for waits for it.
  const [listed, setListed] = useState(false);
  const [line, setLine] = useState("");
  const [scope, setScope] = useState<Scope>("global");
  const [projects, setProjects] = useState<DiscoveredProject[]>([]);
  const [projectPath, setProjectPath] = useState("");
  const [busy, setBusy] = useState(false);
  // The folder the list on show was read with, so a project's rows are signed
  // in to and removed from the project they were listed under.
  const [listCwd, setListCwd] = useState<string | undefined>(undefined);
  const [loggingIn, setLoggingIn] = useState<string | null>(null);
  /** The failing server whose steps are open. */
  const [fixing, setFixing] = useState<string | null>(null);
  const id = useId();
  const lineRef = useRef<HTMLInputElement>(null);
  const rowsRef = useRef<HTMLUListElement>(null);
  const removesRef = useRef<HTMLDivElement>(null);

  const refresh = useCallback(async (cwd?: string): Promise<void> => {
    setLoading(true);
    setListCwd(cwd);
    try {
      setServers(await listMcpServers(cwd));
    } finally {
      setLoading(false);
      setListed(true);
    }
  }, []);

  // On opening, and again when the scope or the project changes (a project's
  // servers differ by project). Reading the list starts each server once, so
  // every read is a live check.
  useEffect(() => {
    if (scope === "project" && projectPath) void refresh(projectPath).catch(() => {});
    if (scope === "global") void refresh().catch(() => {});
  }, [scope, projectPath, refresh]);

  // A remote server's sign-in: the browser opens, then the list is read again.
  useEffect(() => {
    const unsub = subscribe((e: SidecarEvent) => {
      const d = e.data as Record<string, unknown>;
      const name = String(d.name ?? "");
      switch (e.type) {
        case "mcp_auth_url":
          toast(`Opening your browser to sign in to "${name}"…`, "info");
          void openUrl(String(d.url ?? ""));
          break;
        case "mcp_auth_done": {
          setLoggingIn(null);
          const tools = Number(d.toolCount ?? 0);
          toast(`Signed in to "${name}" — ${tools} tools.`, "success");
          void refresh(listCwd).catch(() => {});
          break;
        }
        case "mcp_auth_error":
          setLoggingIn(null);
          toast(`Login failed for "${name}": ${String(d.message ?? "unknown error")}`, "error");
          break;
      }
    });
    return () => unsub();
  }, [refresh, listCwd]);

  useEffect(() => {
    void listProjects()
      .then(setProjects)
      .catch(() => {});
  }, []);

  async function add(): Promise<void> {
    const trimmed = line.trim();
    if (!trimmed || busy) return;
    if (scope === "project" && !projectPath) {
      toast("Enter or pick a project path first.", "warning");
      return;
    }
    setBusy(true);
    try {
      const result = await addMcpServer(
        trimmed,
        scope,
        scope === "project" ? projectPath : undefined,
      );
      setLine("");
      if (result.connected) {
        toast(`Added "${result.name}" — ${result.toolCount} tools.`, "success");
      } else if (result.requiresAuth) {
        toast(`Added "${result.name}". Click "Sign in" to connect.`, "info");
      } else {
        toast(
          `Saved "${result.name}" (not connected${result.error ? `: ${result.error}` : ""}).`,
          "warning",
        );
      }
      await refresh(scope === "project" ? projectPath : undefined);
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "error");
    } finally {
      setBusy(false);
    }
  }

  async function signIn(server: McpServerRow): Promise<void> {
    if (loggingIn) return;
    setLoggingIn(server.name);
    try {
      await loginMcpServer(
        server.name,
        server.scope,
        server.scope === "project" ? listCwd : undefined,
      );
      // The outcome arrives in the mcp_auth_* events above.
    } catch (e) {
      setLoggingIn(null);
      toast(e instanceof Error ? e.message : String(e), "error");
    }
  }

  // After a removal, focus goes to the next server's item; with none, to the field.
  const [removedAt, setRemovedAt] = useState<number | null>(null);
  useEffect(() => {
    if (removedAt === null) return;
    const next = removesRef.current?.children[removedAt]?.querySelector("button");
    if (next) next.focus();
    else lineRef.current?.focus();
    setRemovedAt(null);
  }, [removedAt]);

  async function remove(server: McpServerRow, at: number): Promise<void> {
    const { removed } = await removeMcpServer(
      server.name,
      server.scope,
      server.scope === "project" ? listCwd : undefined,
    );
    if (!removed) throw new Error(`No "${server.name}" found.`);
    toast(`Removed "${server.name}".`, "success");
    await refresh(listCwd);
    setRemovedAt(at);
  }

  // Only the chosen scope's servers: the list holds both, and a project's row
  // shown under Global would have no project to be removed from.
  const visible = servers.filter((s) => s.scope === scope);
  const empty = visible.length === 0 && !loading;
  const total = visible.filter((s) => s.ok).reduce((n, s) => n + s.toolCount, 0);

  // What Overview's Fix asked for, if it did: read once, as the page opens.
  const [arrived] = useState(() => takeSettingsIntent() === "tools-fix");
  const landed = useRef(false);
  // The row to bring into view, once it is drawn (its scope, its steps).
  const [landing, setLanding] = useState<string | null>(null);
  useEffect(() => {
    if (!arrived || landed.current || !listed) return;
    landed.current = true;
    // What Overview counted, in the order it matters: a server that failed, one
    // held back, then one that only needs signing in to.
    const target =
      servers.find((s) => rowState(s) === "failed") ??
      servers.find((s) => rowState(s) === "held") ??
      servers.find((s) => rowState(s) === "auth");
    if (!target) return;
    if (target.scope !== scope) setScope(target.scope);
    if (rowState(target) === "failed") setFixing(rowKey(target));
    setLanding(rowKey(target));
  }, [arrived, listed, servers, scope]);
  useEffect(() => {
    if (landing === null) return;
    const row = [...(rowsRef.current?.children ?? [])].find(
      (li) => (li as HTMLElement).dataset.key === landing,
    );
    if (!row) return;
    row.scrollIntoView?.({ block: "nearest" });
    row.querySelector<HTMLElement>("[data-land]")?.focus();
    setLanding(null);
  }, [landing, visible.length, fixing]);

  // The ruler: a mark every five tools, as far as the largest server needs and
  // one line of ticks can hold.
  const scaleRef = useRef<HTMLSpanElement>(null);
  const [perRow, setPerRow] = useState<number | null>(null);
  useLayoutEffect(() => {
    const el = scaleRef.current;
    if (!el) return;
    const read = (): void => {
      const width = el.clientWidth;
      setPerRow(width > 0 ? Math.max(5, Math.floor((width - COUNT_ROOM) / PITCH / 5) * 5) : null);
    };
    read();
    if (typeof ResizeObserver === "undefined") return;
    const watch = new ResizeObserver(read);
    watch.observe(el);
    return () => watch.disconnect();
  }, []);
  const most = Math.max(0, ...visible.map((s) => (s.ok ? s.toolCount : 0)));
  const top = Math.min(Math.max(15, Math.ceil(most / 5) * 5), perRow ?? MAX_TICKS);
  const marks = Array.from({ length: top / 5 + 1 }, (_, i) => i * 5);

  return (
    <div className="tl-page">
      <div className="tl-head">
        <h2 className="st-label">Servers</h2>
        <span className="tl-head-tools">
          <button
            type="button"
            className="st-text-btn"
            disabled={loading}
            onClick={() => void refresh(listCwd).catch(() => {})}
          >
            <ArrowClockwiseIcon size={12} weight="bold" aria-hidden="true" />
            {loading && listed ? "Checking…" : "Check again"}
          </button>
          <span className="tl-scope" role="group" aria-label="Scope">
            {(["global", "project"] as const).map((sc) => (
              <button
                key={sc}
                type="button"
                className={`tl-scope-btn${scope === sc ? " is-selected" : ""}`}
                aria-pressed={scope === sc}
                onClick={() => setScope(sc)}
              >
                {sc === "global" ? "Global" : "Project"}
              </button>
            ))}
          </span>
        </span>
      </div>
      <p className="tl-lede">An MCP server gives your agents extra tools.</p>
      {scope === "project" && (
        <>
          <input
            className="tl-input tl-project"
            value={projectPath}
            placeholder="Type a project path or pick below…"
            list={`${id}-projects`}
            aria-label="Project path"
            spellCheck={false}
            onChange={(e) => setProjectPath(e.target.value)}
          />
          <datalist id={`${id}-projects`}>
            {projects.map((p) => (
              <option key={p.path} value={p.path}>
                {p.name}
              </option>
            ))}
          </datalist>
        </>
      )}

      <div
        className="tl-bench"
        aria-busy={loading || undefined}
        style={
          {
            "--tl-pitch": `${PITCH}px`,
            ...(perRow === null ? {} : { "--tl-per-row": perRow }),
          } as React.CSSProperties
        }
      >
        <div className="tl-ruler" aria-hidden="true">
          <span className="tl-ruler-name">server</span>
          <span className="tl-ruler-scale" ref={scaleRef}>
            {marks.map((n) => (
              <span key={n} className="tl-mark" style={{ "--n": n } as React.CSSProperties}>
                {n}
              </span>
            ))}
            <span className="tl-unit" style={{ "--n": top } as React.CSSProperties}>
              tools
            </span>
          </span>
        </div>
        {visible.length === 0 ? (
          <p className="tl-empty">
            {loading
              ? "Reading your MCP config…"
              : "No servers yet. Add one below, and its tools appear here."}
          </p>
        ) : (
          <ul className="tl-rows" ref={rowsRef}>
            {visible.map((s, i) => {
              const state = rowState(s);
              const held = heldBack(s);
              const key = rowKey(s);
              const fixId = `${id}-fix-${i}`;
              const open = fixing === key;
              // A held-back server's reason stands in for its raw error.
              const notes = mcpRowNoteLines(s).slice(held ? 1 : 0);
              const drawn = Math.min(s.toolCount, MAX_TICKS);
              return (
                <li key={key} className={`tl-row is-${state}`} data-key={key} data-server={s.name}>
                  <span className="tl-dot" aria-hidden="true" />
                  <span className="tl-name" title={s.summary}>
                    {s.name}
                  </span>
                  <span className="tl-track">
                    <span
                      className="tl-ticks"
                      role="img"
                      aria-label={
                        state === "ok"
                          ? toolWords(s.toolCount)
                          : `No tools loaded: ${STATE_WORDS[state]}`
                      }
                    >
                      {Array.from({ length: state === "ok" ? drawn : STUB_TICKS }, (_, t) => (
                        <span key={t} className="tl-tick" />
                      ))}
                      {state === "ok" && s.toolCount > MAX_TICKS && (
                        <span className="tl-more">{`+${s.toolCount - MAX_TICKS}`}</span>
                      )}
                      {state !== "ok" && <span className="tl-tick-run" />}
                    </span>
                    <span className="tl-count" aria-hidden="true">
                      {state === "ok" ? s.toolCount : STATE_WORDS[state]}
                    </span>
                  </span>
                  <span className="tl-action">
                    {state === "auth" ? (
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        disabled={loggingIn === s.name}
                        title={`Sign in to "${s.name}"`}
                        data-land
                        onClick={() => void signIn(s)}
                      >
                        {loggingIn === s.name ? "Signing in…" : "Sign in"}
                      </button>
                    ) : state === "failed" ? (
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        aria-expanded={open}
                        aria-controls={fixId}
                        aria-label={`Fix ${s.name}`}
                        onClick={() => setFixing(open ? null : key)}
                      >
                        Fix
                      </button>
                    ) : null}
                  </span>
                  <span className="tl-where">{serverShortForm(s)}</span>
                  {held && (
                    <p className="tl-held" tabIndex={-1} data-land>
                      <span className="tl-why">{held.why}</span>
                      <span className="tl-next">{held.next}</span>
                    </p>
                  )}
                  {notes.length > 0 && (
                    <ul className="tl-notes" aria-label={`Notes for ${s.name}`}>
                      {notes.map((note, n) => (
                        <li
                          key={n}
                          className={
                            state === "failed" && n === 0
                              ? "tl-why"
                              : note.attention
                                ? "tl-note-flag"
                                : "tl-note-rest"
                          }
                        >
                          {note.text}
                        </li>
                      ))}
                    </ul>
                  )}
                  {state === "failed" && (
                    <div className="tl-fix" id={fixId} hidden={!open}>
                      {/* Drawn only once asked for: the command or address can hold a key. */}
                      {open && (
                        <>
                          <h3 className="st-label" tabIndex={-1} data-land>
                            How to fix it
                          </h3>
                          <ol className="tl-steps">
                            <li>
                              <FixStepText
                                step={{
                                  text:
                                    s.kind === "stdio"
                                      ? "Run its command in Terminal to see why it stops."
                                      : "Check this address opens and the server is up.",
                                  command: s.summary,
                                }}
                              />
                            </li>
                            <li>Fix what it reports there.</li>
                            <li>Press Check again.</li>
                          </ol>
                        </>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        {visible.length > 0 && (
          <p className="tl-caption">
            {total > 0
              ? `Each tick is a tool your agents can call: ${toolWords(total)} in all.`
              : "None of these servers has loaded, so your agents have no tools from them."}
          </p>
        )}
      </div>

      <section className="tl-add" aria-labelledby={`${id}-add`}>
        <h2 className="st-label" id={`${id}-add`}>
          Add a server
        </h2>
        <form
          className="tl-add-row"
          onSubmit={(e) => {
            e.preventDefault();
            // With no servers Add is the one thing to do: nothing pasted yet, it points at the field.
            if (!line.trim()) lineRef.current?.focus();
            else void add();
          }}
        >
          <input
            ref={lineRef}
            className="tl-input"
            value={line}
            placeholder="claude mcp add --transport http notion https://mcp.notion.com/mcp"
            aria-label="Server's add command"
            spellCheck={false}
            onChange={(e) => setLine(e.target.value)}
          />
          <button
            type="submit"
            className={`btn ${empty ? "btn-primary" : "btn-ghost"} tl-add-btn`}
            disabled={busy || (!empty && !line.trim())}
          >
            {busy ? "Adding…" : "Add"}
          </button>
        </form>
        <p className="tl-note">
          {`Paste the server's add command. It's saved to ${scope === "global" ? "every session" : "this project"}, and loads after Kleio restarts.`}
        </p>
      </section>

      {visible.length > 0 && (
        <RemoveGroup>
          <div ref={removesRef}>
            {visible.map((s, i) => (
              <RemoveItem
                key={rowKey(s)}
                what={s.name}
                ask="Remove"
                label={`Remove ${s.name}`}
                confirm="Remove"
                busyText="Removing…"
                hint={
                  s.ok
                    ? `Your agents lose its ${toolWords(s.toolCount)}, and any sign-in saved for it. Add it again to bring it back.`
                    : "It's taken out of your MCP config, with any sign-in saved for it. Add it again to bring it back."
                }
                onRemove={() => remove(s, i)}
                describeError={(e) => (e instanceof Error ? e.message : String(e))}
              />
            ))}
          </div>
        </RemoveGroup>
      )}
    </div>
  );
}

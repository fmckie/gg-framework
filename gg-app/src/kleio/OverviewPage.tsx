// Settings → Overview, on the desktop: the page Settings lands on, and the only
// place health is summarised. A headline in Kleio's own words, then one
// hairline row per area: what it does for you first, its state second, each
// with its own glyph and at most one action. While a needed step is left, the
// next one is a hero holding the page's one filled button, under a bar of one
// segment per needed step. No forms: every row leads to the tab that has them.
// The phone keeps the Setup page (settingsLayout.tsx).

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowClockwiseIcon,
  BrainIcon,
  CaretRightIcon,
  CpuIcon,
  HardDrivesIcon,
  MicrophoneIcon,
  PuzzlePieceIcon,
  SquaresFourIcon,
  WaveformIcon,
  type Icon,
} from "@phosphor-icons/react";
import {
  authStatusWithError,
  getLocalModels,
  listMcpServers,
  listMemories,
  type AuthStatusResult,
} from "../agent";
import { localStorageOrNull, markSetupSeen } from "../app-entry-view";
import type { SettingsTabId } from "../SettingsScreen";
import { hostRowWords } from "./AlwaysOn";
import { connectionState } from "./connectionState";
import { shortHost } from "./host-name";
import { askHostKind, rememberedHostKind, useHostReach, useHostReachWords } from "./hostReach";
import {
  errorText,
  getDictationSetup,
  getSetupStatus,
  getVoiceStatus,
  KleioApiError,
  listConnections,
  type ConnectionList,
  type DictationSetup,
  type HostKind,
  type SetupStatus,
  type VoiceStatus,
} from "./kleioApi";
import { quotableMemories } from "./quotableMemories";
import { privateServers } from "./privateModels";
import { useKleioRemote } from "./useKleioRemote";
import { VOICE_LABELS } from "./VoiceCard";

/**
 * A row's mark. `ok` is fine; `fault` is broken; `signin` and `unset` wait on
 * you; the rest (optional, waiting on the host, can't check, still asking)
 * are quiet.
 */
type Mark = "ok" | "fault" | "signin" | "unset" | "optional" | "waiting" | "unknown" | "checking";
type RowId = "host" | "models" | "voice" | "apps" | "tools" | "dictation" | "brain";

interface RowState {
  mark: Mark;
  status: string;
  /** Still asking for the first time: the page waits for it before it speaks. */
  pending?: true;
  /** Couldn't be read: the status is announced and the row offers Try again. */
  failed?: true;
  /** Needs a key only the admin device can add: no action from here. */
  adminOnly?: true;
}
interface Row extends RowState {
  id: RowId;
  area: string;
  glyph: Icon;
  /** What it does for you: the row's first line. */
  benefit: string;
  tab: SettingsTabId;
  /** A quiet extra on a row that is fine (the host's "Keep it on"). */
  extra?: string;
}

const REQUIRED: readonly RowId[] = ["host", "models", "voice", "apps"];
/** Coming back to the window re-reads everything, at most this often. */
export const REREAD_MS = 5_000;
/** How long a blank page waits for slow answers before showing the rows anyway. */
export const SETTLE_MS = 1_500;

/** An answer: undefined while asking, Error when it couldn't. Kept while re-asking. */
type Asked<T> = T | undefined | Error;

function useAsk<T>(ask: () => Promise<T>, tick: number): Asked<T> {
  const [value, setValue] = useState<Asked<T>>(undefined);
  useEffect(() => {
    let live = true;
    ask().then(
      (v) => live && setValue(v),
      (e: unknown) => live && setValue(e instanceof Error ? e : new Error(String(e))),
    );
    return () => {
      live = false;
    };
    // Asked again on each tick; `ask` itself never changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick]);
  return value;
}

function list(names: string[]): string {
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

function partOfDay(hour: number): string {
  return hour < 5 ? "evening" : hour < 12 ? "morning" : hour < 18 ? "afternoon" : "evening";
}

const CHECKING: RowState = { mark: "checking", status: "Checking…", pending: true };
const OLD_HOST: RowState = { mark: "unknown", status: "Update Kleio on your host to check" };

/** A read that failed: an older host can't say; anything else says why. */
function couldnt(e: Error, oldStatuses: readonly number[] = [404]): RowState {
  if (e instanceof KleioApiError && oldStatuses.includes(e.status)) return OLD_HOST;
  return { mark: "unknown", status: `Couldn't check: ${errorText(e)}`, failed: true };
}

/** The hero's one-line benefit and its action, for the next needed step. */
const HERO: Partial<Record<RowId, { line: string; cta: string }>> = {
  models: {
    line: "Connect Anthropic, OpenAI or another provider, and Kleio can think alongside you.",
    cta: "Connect a model",
  },
  voice: {
    line: "Add an OpenAI key, then just talk. Kleio answers in a natural voice.",
    cta: "Add OpenAI key",
  },
  apps: {
    line: "Add a Composio key, and Kleio can handle Gmail, Calendar, Notion and more.",
    cta: "Add Composio key",
  },
};

export function OverviewPage({
  onOpenTab,
}: {
  onOpenTab: (tab: SettingsTabId) => void;
}): React.ReactElement {
  const reach = useHostReach();
  const words = useHostReachWords();
  const remote = useKleioRemote().status;
  const host = remote?.active?.host ?? remote?.paired?.host;
  const hostName = host ? shortHost(host) : "your host";

  // Seeing Overview, however it was reached, means it needn't open by itself again.
  useEffect(() => markSetupSeen(localStorageOrNull()), []);

  // Back from another window or the browser: ask again, so a step done
  // elsewhere shows here. Never while hidden, and not more than once in a while.
  const [tick, setTick] = useState(0);
  const asked = useRef(0);
  useEffect(() => {
    asked.current = Date.now();
  }, []);
  const again = useCallback((force: boolean): void => {
    if (document.visibilityState === "hidden") return;
    const now = Date.now();
    if (!force && now - asked.current < REREAD_MS) return;
    asked.current = now;
    setTick((t) => t + 1);
  }, []);
  useEffect(() => {
    const back = (): void => again(false);
    window.addEventListener("focus", back);
    document.addEventListener("visibilitychange", back);
    return () => {
      window.removeEventListener("focus", back);
      document.removeEventListener("visibilitychange", back);
    };
  }, [again]);

  const auth = useAsk<AuthStatusResult>(authStatusWithError, tick);
  const local = useAsk(getLocalModels, tick);
  const voice = useAsk<VoiceStatus>(getVoiceStatus, tick);
  const setup = useAsk<SetupStatus>(getSetupStatus, tick);
  const apps = useAsk<ConnectionList>(listConnections, tick);
  const dictation = useAsk<DictationSetup>(getDictationSetup, tick);
  const memories = useAsk(listMemories, tick);
  const mcp = useAsk(() => listMcpServers(), tick);
  // Whether the host stays on: asked once, else what it last said.
  const [hostKind, setHostKind] = useState<HostKind | null | undefined>(undefined);
  useEffect(() => {
    let live = true;
    void askHostKind().then((kind) => live && setHostKind(kind ?? rememberedHostKind()));
    return () => {
      live = false;
    };
  }, []);

  // A blank page doesn't wait for ever on one slow answer.
  const [waited, setWaited] = useState(false);
  useEffect(() => {
    const t = window.setTimeout(() => setWaited(true), SETTLE_MS);
    return () => window.clearTimeout(t);
  }, []);

  const offline = reach === "disconnected";
  const admin = setup instanceof Error || setup === undefined ? true : setup.admin;
  const waiting: RowState = { mark: "waiting", status: `Waiting for ${hostName}` };
  /** A key this device can't add: say whose job it is, and offer nothing. */
  const needsKey = (key: string): RowState =>
    admin
      ? { mark: "unset", status: `Needs ${key}` }
      : { mark: "unset", status: `Needs ${key}, from your admin device`, adminOnly: true };

  const stays = hostRowWords(hostKind, hostName);
  const host_: Row = {
    id: "host",
    area: "Host",
    glyph: HardDrivesIcon,
    benefit: reach === "connected" ? stays.benefit : `Lives on ${hostName}`,
    tab: "connection",
    ...(reach === "connected"
      ? { mark: "ok", status: stays.status, ...(stays.keepOn ? { extra: "Keep it on" } : {}) }
      : reach === "checking"
        ? CHECKING
        : {
            mark: "fault",
            status: words ? words.headline.replace(/[.…]$/, "") : "Can't reach it right now",
          }),
  };

  const signedIn =
    auth instanceof Error || auth === undefined
      ? []
      : auth.providers.filter((p) => p.connected).map((p) => p.label);
  const privateNames =
    local instanceof Error || local === undefined
      ? []
      : (["tinfoil", "ollama"] as const)
          .map((k) => privateServers(local)[k])
          .filter((s) => s.reachable && s.usableModels > 0)
          .map((s) => s.endpoint?.label ?? "");
  const models = [...signedIn, ...privateNames];
  const models_: Row = {
    id: "models",
    area: "Models",
    glyph: CpuIcon,
    benefit: "Thinks with the models you choose",
    tab: "providers",
    ...(auth === undefined || local === undefined
      ? CHECKING
      : models.length > 0
        ? { mark: "ok", status: list(models) }
        : auth instanceof Error
          ? couldnt(auth, [])
          : auth.error
            ? { mark: "fault", status: "Couldn't read your AI providers" }
            : { mark: "unset", status: "Needs an AI provider" }),
  };

  const voice_: Row = {
    id: "voice",
    area: "Voice",
    glyph: WaveformIcon,
    benefit: "Talk to Kleio out loud",
    tab: "kleio",
    ...(offline
      ? waiting
      : voice === undefined
        ? CHECKING
        : voice instanceof Error
          ? couldnt(voice)
          : voice.ready
            ? {
                mark: "ok",
                // "Marin (natural, recommended)" is the picker's; the row wants the name.
                status: `Ready, in ${(VOICE_LABELS[voice.voice] ?? voice.voice).replace(/ \(.*$/, "")}'s voice`,
              }
            : needsKey("an OpenAI key")),
  };

  const conns = apps instanceof Error || apps === undefined ? [] : apps.connections;
  const broken = conns.filter((c) => ["expired", "failed"].includes(connectionState(c.status)));
  const connected = conns.filter((c) => connectionState(c.status) === "connected");
  const apps_: Row = {
    id: "apps",
    area: "Apps",
    glyph: SquaresFourIcon,
    benefit: "Gets things done in your apps",
    tab: "apps",
    ...(offline
      ? waiting
      : setup === undefined
        ? CHECKING
        : setup instanceof Error
          ? couldnt(setup)
          : setup.keys.composio === "missing"
            ? needsKey("a Composio key")
            : apps === undefined
              ? CHECKING
              : apps instanceof Error
                ? couldnt(apps)
                : broken.length > 0
                  ? {
                      mark: "signin",
                      status: `${list(broken.map((c) => c.name))} ${broken.length === 1 ? "needs" : "need"} signing in again`,
                    }
                  : connected.length > 0
                    ? { mark: "ok", status: list(connected.map((c) => c.name)) }
                    : { mark: "ok", status: "Ready, no apps added yet" }),
  };

  // Local: the MCP servers this Mac's agent uses. Optional until one fails. A
  // list that couldn't be read comes back empty (agent.ts), so it reads as none.
  const servers = mcp instanceof Error || mcp === undefined ? null : mcp;
  const down = servers?.filter((s) => !s.ok) ?? [];
  const failing = down.filter((s) => !s.requiresAuth);
  const toolCount = servers?.reduce((n, s) => n + s.toolCount, 0) ?? 0;
  const needAuth = down.filter((s) => s.requiresAuth);
  const isnt = `${list(failing.map((s) => s.name))} ${failing.length === 1 ? "isn't" : "aren't"} working`;
  const signIn = `${list(needAuth.map((s) => s.name))} ${needAuth.length === 1 ? "needs" : "need"} signing in again`;
  const tools_: Row = {
    id: "tools",
    area: "Tools",
    glyph: PuzzlePieceIcon,
    benefit: "Uses your own tools and servers",
    tab: "mcp",
    ...(mcp === undefined
      ? CHECKING
      : servers === null || servers.length === 0
        ? { mark: "optional", status: "Optional · add your own MCP servers" }
        : failing.length > 0
          ? {
              mark: "fault",
              // Both kinds, so the row names every server the headline counts.
              status: [isnt, ...(needAuth.length > 0 ? [signIn] : [])].join(" \u00b7 "),
            }
          : down.length > 0
            ? { mark: "signin", status: signIn }
            : {
                mark: "ok",
                status: `${servers.length} ${servers.length === 1 ? "server" : "servers"}, ${toolCount} ${toolCount === 1 ? "tool" : "tools"}`,
              }),
  };

  const dictation_: Row = {
    id: "dictation",
    area: "Dictation",
    glyph: MicrophoneIcon,
    benefit: "Speak instead of typing",
    tab: "kleio",
    ...(offline
      ? waiting
      : dictation === undefined
        ? CHECKING
        : dictation instanceof Error
          ? // A host from before this step: 404 for an admin device, 403 for any other.
            couldnt(dictation, [403, 404])
          : (
              {
                ready: { mark: "ok", status: `Ready, on ${hostName}` },
                downloading: { mark: "checking", status: "Downloading…" },
                loading: { mark: "checking", status: "Getting ready…" },
                absent: { mark: "optional", status: `Optional · runs privately on ${hostName}` },
                failed: { mark: "fault", status: "The download didn't finish" },
                unsupported: { mark: "unknown", status: `Not available on ${hostName}` },
              } satisfies Record<DictationSetup["state"], RowState>
            )[dictation.state]),
  };

  const mems = memories instanceof Error || memories === undefined ? null : memories.memories;
  const brain_: Row = {
    id: "brain",
    area: "Brain",
    glyph: BrainIcon,
    benefit: "Remembers what matters to you",
    tab: "kleio",
    ...(memories === undefined
      ? CHECKING
      : memories instanceof Error || mems === null
        ? couldnt(memories instanceof Error ? memories : new Error("no answer"), [])
        : mems.length === 0
          ? { mark: "optional", status: "Optional · introduce yourself" }
          : {
              mark: "ok",
              status: `${mems.length} ${mems.length === 1 ? "memory" : "memories"}, shared by every device`,
            }),
  };

  const rows = [host_, models_, voice_, apps_, tools_, dictation_, brain_];
  const required = rows.filter((r) => REQUIRED.includes(r.id));
  const done = required.filter((r) => r.mark === "ok").length;
  const settled = remote !== null && rows.every((r) => !r.pending);

  if (!settled && !waited) return <div className="ov-page is-loading" aria-busy="true" />;

  // ── what to say ────────────────────────────────────────────────────────────
  const needs = rows.find((r) => r.mark === "fault" || r.mark === "signin");
  // The next needed step this device can take; a key only the admin can add isn't one.
  const next =
    settled && !offline && !needs
      ? required.find((r) => r.mark === "unset" && !r.adminOnly)
      : undefined;
  const left = settled && !offline && !needs && required.some((r) => r.mark === "unset");
  const quoted = mems ? quotableMemories(mems)[0] : undefined;

  let headline: string;
  let sub: string | null;
  if (offline) {
    headline = `${hostName} isn't answering.`;
    sub = "I'll keep trying in the background. Fix shows what to check.";
  } else if (needs) {
    headline =
      needs.id === "tools"
        ? down.length === 1
          ? "One of your tools needs a look."
          : `${down.length} of your tools need a look.`
        : `${needs.area} needs a look.`;
    sub = `Everything else is running on ${hostName}.`;
  } else if (left) {
    headline = "Let's get Kleio ready.";
    sub = null;
  } else {
    headline = `Good ${partOfDay(new Date().getHours())}.`;
    sub = `I'm on ${hostName}, and everything's running.`;
  }

  const listed = rows.filter((r) => r.id !== next?.id);
  const hero = next ? HERO[next.id] : undefined;
  const HeroGlyph = next?.glyph;
  const firstFix = rows.find((r) => r.mark === "fault" || r.mark === "signin")?.id;

  return (
    <div
      className={`ov-page${left ? " is-onboarding" : ""}`}
      aria-busy={settled ? undefined : true}
    >
      {/* Kleio speaks once every answer is in, so the headline never changes under you. */}
      {settled && (
        <header className="ov-head">
          <h2 className="ov-headline">{headline}</h2>
          {sub && <p className="ov-sub">{sub}</p>}
        </header>
      )}

      {setup !== undefined && !(setup instanceof Error) && !setup.admin && (
        <p className="ov-note" role="note">
          This device shows what's done. Only your admin device can add or change keys.
        </p>
      )}

      {left && (
        <div
          className="ov-progress"
          role="progressbar"
          aria-label="Setup"
          aria-valuemin={0}
          aria-valuemax={REQUIRED.length}
          aria-valuenow={done}
          aria-valuetext={`${done} of ${REQUIRED.length} ready`}
        >
          {required.map((r) => (
            <span
              key={r.id}
              className={`ov-seg${r.mark === "ok" ? " is-done" : ""}${r.id === next?.id ? " is-next" : ""}`}
            />
          ))}
        </div>
      )}

      {settled && !left && !offline && !needs && quoted && mems && (
        <a
          className="ov-memory"
          href="#kleio"
          onClick={(e) => {
            e.preventDefault();
            onOpenTab("kleio");
          }}
        >
          <span className="ov-glyph" aria-hidden="true">
            <BrainIcon size={18} weight="light" />
          </span>
          <span className="ov-memory-text">
            <span className="ov-memory-label">{`I remember ${mems.length} ${mems.length === 1 ? "thing" : "things"} about you`}</span>
            <span className="ov-memory-quote">{`“${quoted.text}”`}</span>
          </span>
          <CaretRightIcon className="ov-chevron" size={14} weight="light" aria-hidden="true" />
        </a>
      )}

      {next && hero && HeroGlyph && (
        <section className="ov-hero" aria-labelledby="ov-hero-title">
          <span className="ov-hero-glyph" aria-hidden="true">
            <HeroGlyph size={28} weight="light" />
          </span>
          <div className="ov-hero-text">
            <p className="ov-hero-eyebrow">Next</p>
            <h3 className="ov-hero-title" id="ov-hero-title">
              {next.benefit}
            </h3>
            <p className="ov-hero-line">{hero.line}</p>
          </div>
          <button
            type="button"
            className="btn btn-primary ov-hero-cta"
            onClick={() => onOpenTab(next.tab)}
          >
            {hero.cta}
          </button>
        </section>
      )}

      <ul className="ov-rows" aria-label="Areas">
        {listed.map((row) => (
          <OverviewRow
            key={row.id}
            row={row}
            quiet={Boolean(next)}
            primary={row.id === firstFix}
            onOpen={() => onOpenTab(row.tab)}
            onRetry={() => again(true)}
          />
        ))}
      </ul>
    </div>
  );
}

function OverviewRow({
  row,
  quiet,
  primary,
  onOpen,
  onRetry,
}: {
  row: Row;
  /** A hero holds the page's one filled button, so rows stay quiet. */
  quiet: boolean;
  /** The first row that needs fixing: its Fix is the page's one filled button. */
  primary: boolean;
  onOpen: () => void;
  /** Asks for everything again. */
  onRetry: () => void;
}): React.ReactElement {
  const Glyph = row.glyph;
  const body = (
    <>
      <span className="ov-glyph" aria-hidden="true">
        <Glyph size={18} weight="light" />
        <span className={`ov-dot is-${row.mark}`} />
      </span>
      <span className="ov-text">
        <span className="ov-benefit">{row.benefit}</span>
        {/* Why a row couldn't be read is said aloud, not only shown. */}
        <span className="ov-status" role={row.failed ? "alert" : undefined}>
          {row.status}
        </span>
      </span>
    </>
  );
  const action =
    row.mark === "fault" || row.mark === "signin" ? (
      <button
        type="button"
        className={`btn ${primary ? "btn-primary" : "btn-ghost"} btn-sm ov-action`}
        onClick={onOpen}
        aria-label={`Fix ${row.area}`}
      >
        Fix
      </button>
    ) : row.failed ? (
      <button
        type="button"
        className="st-text-btn"
        onClick={onRetry}
        aria-label={`Try again: ${row.area}`}
      >
        <ArrowClockwiseIcon size={12} weight="bold" aria-hidden="true" />
        Try again
      </button>
    ) : row.adminOnly ? null : row.mark === "unset" && !quiet ? (
      <button
        type="button"
        className="btn btn-ghost btn-sm ov-action"
        onClick={onOpen}
        aria-label={`Set up ${row.area}`}
      >
        Set up
      </button>
    ) : row.mark === "unset" || row.mark === "optional" ? (
      <button
        type="button"
        className="ov-text-action"
        onClick={onOpen}
        aria-label={`Set up ${row.area}`}
      >
        Set up
      </button>
    ) : row.extra ? (
      <button type="button" className="ov-text-action" onClick={onOpen}>
        {row.extra}
      </button>
    ) : null;
  return (
    <li className={`ov-row is-${row.mark}`} data-row={row.id}>
      {row.mark === "ok" ? (
        <a
          className="ov-row-main ov-row-link"
          href={`#${row.tab}`}
          aria-label={`${row.area}: ${row.benefit}. ${row.status}. Open ${row.area}.`}
          onClick={(e) => {
            e.preventDefault();
            onOpen();
          }}
        >
          {body}
          <CaretRightIcon className="ov-chevron" size={14} weight="light" aria-hidden="true" />
        </a>
      ) : (
        <div
          className="ov-row-main"
          role="group"
          aria-label={`${row.area}: ${row.benefit}. ${row.status}.`}
        >
          {body}
        </div>
      )}
      {action && <span className="ov-row-action">{action}</span>}
    </li>
  );
}

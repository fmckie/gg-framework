import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import { ShieldCheckIcon } from "@phosphor-icons/react";
import { theme } from "./theme";
import {
  authStatusWithError,
  getLocalModels,
  subscribe,
  type AuthProvider,
  type LocalModelsState,
  type SidecarEvent,
} from "./agent";
import { Badge } from "./Badge";
import { BackButton } from "./BackButton";
import { ProviderLoginModal } from "./ProviderLoginModal";

import { providerLogo } from "./provider-logos";
import { SettingsHeaderStatus } from "./settings-header";
import { SettingsCard } from "./settings-section";
import { privateServers, type PrivateServerState } from "./kleio/privateModels";

// Local-model setup and downloads are explicit actions, not startup work.
const LocalModelsModal = lazy(() =>
  import("./LocalModelsModal").then((m) => ({ default: m.LocalModelsModal })),
);
const HfPullModal = lazy(() => import("./HfPullModal").then((m) => ({ default: m.HfPullModal })));

interface Props {
  /**
   * Shown as its own screen, with a header and Back. Omitted inside the
   * Settings screen's AI Providers tab, which supplies both.
   */
  onClose?: () => void;
}

/** A private server's badge: what it's doing right now, in a word or two. */
function serverBadge(server: PrivateServerState, idle: string): React.ReactElement {
  if (server.reachable) {
    return (
      <Badge color={theme.success}>
        {server.usableModels > 0
          ? `${server.usableModels} model${server.usableModels === 1 ? "" : "s"}`
          : "Running"}
      </Badge>
    );
  }
  return <Badge>{server.endpoint ? "Not running" : idle}</Badge>;
}

/**
 * Provider login hub. Shows every supported AI provider as a grid of logo
 * tiles with a live connection dot; selecting one opens a modal that adapts
 * to OAuth, API key, or both. Mirrors `ggcoder login` in the desktop app.
 *
 * kleio: private models (Tinfoil, Ollama, Hugging Face — run by the Mac mini)
 * come first, as the recommended way to use Kleio; cloud providers follow.
 */
export function LoginScreen({ onClose }: Props): React.ReactElement {
  const [providers, setProviders] = useState<AuthProvider[]>([]);
  const [local, setLocal] = useState<LocalModelsState>({ endpoints: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [active, setActive] = useState<AuthProvider | null>(null);
  const [localOpen, setLocalOpen] = useState(false);
  // Swapped in place (never stacked) so Escape closes exactly one modal.
  const [hfOpen, setHfOpen] = useState(false);
  const openHfPull = useCallback((): void => {
    setActive(null);
    setLocalOpen(false);
    setHfOpen(true);
  }, []);

  const load = useCallback(async (): Promise<AuthProvider[]> => {
    const status = await authStatusWithError();
    setProviders(status.providers);
    setError(status.error);
    setLoading(false);
    return status.providers;
  }, []);

  const refresh = useCallback(async (): Promise<void> => {
    const list = await load();
    // Keep the open modal's `connected` flag in sync after a change.
    setActive((cur) => (cur ? (list.find((p) => p.value === cur.value) ?? cur) : cur));
  }, [load]);

  const refreshLocal = useCallback(async (): Promise<void> => {
    setLocal(await getLocalModels());
  }, []);

  useEffect(() => {
    let cancelled = false;
    void authStatusWithError()
      .then((status) => {
        if (!cancelled) {
          setProviders(status.providers);
          setError(status.error);
          setLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) setLoading(false);
      });
    // The private servers' state (last scan; cheap, never probes).
    void getLocalModels().then((state) => {
      if (!cancelled) setLocal(state);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // ~/.gg/auth.json is shared by every window, so connecting or disconnecting
  // anywhere changes what THIS screen should show. `auth_change` covers both
  // directions (unlike `auth_done`, which only means a login succeeded);
  // without re-reading here the connection dots and the "N connected" badge
  // stay stale until the screen is reopened. A local-model rescan changes the
  // private servers' state the same way.
  useEffect(() => {
    const unsub = subscribe((e: SidecarEvent) => {
      if (e.type === "auth_change") void refresh();
      if (e.type === "models_change") void refreshLocal();
    });
    return () => unsub();
  }, [refresh, refreshLocal]);

  const servers = privateServers(local);
  const privateReady = [servers.tinfoil, servers.ollama].filter((s) => s.reachable).length;
  const connectedCount = providers.filter((p) => p.connected).length + privateReady;

  const connectedBadge = loading ? null : (
    <Badge color={connectedCount > 0 ? theme.success : undefined}>
      {`${connectedCount} connected`}
    </Badge>
  );

  const localTiles = (
    <>
      {/* Tinfoil: private AI on confidential hardware, which the Mac mini
          reaches through its own proxy. Set up on the host, so this tile
          explains and shows status rather than signing in. */}
      <button
        type="button"
        className="login-tile"
        onClick={() => setLocalOpen(true)}
        title="Tinfoil — private AI in secure hardware, set up on your Mac mini"
      >
        {servers.tinfoil.reachable && (
          <span className="login-conn-dot" title="Running" aria-label="Running" />
        )}
        <span className="login-tile-logo">
          <span className="login-logo-mark login-logo-tinfoil" aria-hidden="true">
            <ShieldCheckIcon size={30} weight="fill" />
          </span>
        </span>
        <span className="login-tile-name">Tinfoil</span>
        <span className="login-tile-methods">
          {serverBadge(servers.tinfoil, "Set up on Mac mini")}
        </span>
      </button>
      {/* Ollama's official mark (dark-icon-64 from ollama.com), same 48px
          logo box as every provider tile. */}
      <button
        type="button"
        className="login-tile"
        onClick={() => setLocalOpen(true)}
        title="Ollama — models running on your Mac mini"
      >
        {servers.ollama.reachable && (
          <span className="login-conn-dot" title="Running" aria-label="Running" />
        )}
        <span className="login-tile-logo">
          <img className="login-logo" src={providerLogo("ollama")} alt="" />
        </span>
        <span className="login-tile-name">Ollama</span>
        <span className="login-tile-methods">{serverBadge(servers.ollama, "No key needed")}</span>
      </button>
      {/* The local twin: search the Hub and download models straight into
          Ollama — no token, no account. */}
      <button
        type="button"
        className="login-tile"
        onClick={() => setHfOpen(true)}
        title="Hugging Face — download models to Ollama"
      >
        <span className="login-tile-logo">
          <img className="login-logo" src={providerLogo("huggingface")} alt="" />
        </span>
        <span className="login-tile-name">Hugging Face</span>
        <span className="login-tile-methods">
          <Badge>Download models</Badge>
        </span>
      </button>
    </>
  );

  const cloudTiles = (
    <>
      {loading && (
        <div className="picker-empty" style={{ color: theme.textDim }}>
          {"checking providers\u2026"}
        </div>
      )}
      {!loading && error && providers.length === 0 && (
        <p className="login-error" role="status">
          {error}
        </p>
      )}
      {providers.map((p) => {
        const logo = providerLogo(p.value);
        return (
          <button key={p.value} type="button" className="login-tile" onClick={() => setActive(p)}>
            {p.connected && (
              <span className="login-conn-dot" title="Connected" aria-label="Connected" />
            )}
            <span className="login-tile-logo">
              {logo ? (
                <img className="login-logo" src={logo} alt="" />
              ) : (
                <span className="login-logo-fallback">{p.label.charAt(0)}</span>
              )}
            </span>
            <span className="login-tile-name">{p.label}</span>
            <span className="login-tile-methods">
              {p.methods.map((m) => {
                // Providers can support two methods and have BOTH connected, so
                // colour each badge by its own state instead of the tile's one
                // dot: green = this credential is on file. The dot above still
                // answers "is this provider usable at all".
                const isConnected = (p.connectedMethods ?? []).includes(m);
                const isActive = p.activeMethod === m;
                const label = m === "oauth" ? "OAuth" : "API key";
                return (
                  <Badge
                    key={m}
                    color={isConnected ? theme.success : undefined}
                    title={
                      isConnected
                        ? isActive
                          ? `${label} — connected, in use`
                          : `${label} — connected, standby`
                        : `${label} — not connected`
                    }
                  >
                    {label}
                  </Badge>
                );
              })}
            </span>
          </button>
        );
      })}
    </>
  );

  return (
    <div className={onClose ? "picker" : "settings-panel"}>
      {onClose ? (
        <div className="picker-head" data-tauri-drag-region>
          <BackButton label="Back" onClick={onClose} />
          <span className="picker-title">AI Providers</span>
          {connectedBadge}
        </div>
      ) : (
        <>
          {/* In Settings the screen header names the page; the count joins it. */}
          <SettingsHeaderStatus>{connectedBadge}</SettingsHeaderStatus>
        </>
      )}

      <div className={onClose ? "login-scroll" : "login-sections"}>
        <SettingsCard
          title="Private models"
          description={
            <>
              <Badge color={theme.success} className="login-recommended">
                Recommended
              </Badge>{" "}
              Run on your Mac mini or in secure hardware, so your chats stay yours.
            </>
          }
        >
          <div className="login-grid">{localTiles}</div>
        </SettingsCard>
        <SettingsCard
          title="Cloud providers"
          description="Sign in to use their models too. Your messages go to that company."
        >
          <div className="login-grid">{cloudTiles}</div>
        </SettingsCard>
      </div>

      {active && (
        <ProviderLoginModal
          provider={active}
          onClose={() => setActive(null)}
          onChanged={() => void refresh()}
          {...(active.value === "huggingface" ? { onOpenHfPull: openHfPull } : {})}
        />
      )}

      <Suspense fallback={null}>
        {localOpen && (
          <LocalModelsModal
            onClose={() => {
              setLocalOpen(false);
              void refreshLocal();
            }}
          />
        )}
        {hfOpen && <HfPullModal onClose={() => setHfOpen(false)} />}
      </Suspense>
    </div>
  );
}

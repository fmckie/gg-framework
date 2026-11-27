// Settings → AI Providers, on the desktop: one hairline ring labelled Private.
// Inside it sit the models that run on your host or in secure hardware
// (Tinfoil, Ollama, and Hugging Face's downloads into Ollama). Connected cloud
// providers sit outside it, because messages to them go to that company, and
// the rest wait under "Add a provider". Every provider opens the dialog it
// always did. The phone keeps LoginScreen (settingsLayout.tsx), whose loading
// this repeats until the iPhone slice.

import { Fragment, lazy, Suspense, useCallback, useEffect, useId, useState } from "react";
import { ShieldCheckIcon } from "@phosphor-icons/react";
import {
  authStatusWithError,
  getLocalModels,
  subscribe,
  type AuthMethod,
  type AuthProvider,
  type LocalModelsState,
  type SidecarEvent,
} from "../agent";
import { Badge } from "../Badge";
import { ProviderLoginModal } from "../ProviderLoginModal";
import { providerLogo } from "../provider-logos";
import { SettingsHeaderStatus } from "../settings-header";
import { theme } from "../theme";
import { KleioMark } from "./KleioMark";
import { privateServers, type PrivateServerState } from "./privateModels";

// Local-model setup and downloads are explicit actions, not startup work.
const LocalModelsModal = lazy(() =>
  import("../LocalModelsModal").then((m) => ({ default: m.LocalModelsModal })),
);
const HfPullModal = lazy(() => import("../HfPullModal").then((m) => ({ default: m.HfPullModal })));

const METHOD_LABEL: Record<AuthMethod, string> = { oauth: "OAuth", apikey: "API key" };

/** What is true of every model inside the ring. Tinfoil is secure hardware, not your own. */
const PRIVATE_LINE =
  "Inside the ring, models run on your host or in secure hardware, so your chats stay yours.";

/** A private server's state, in a word or two. */
function serverWords(server: PrivateServerState, idle: string): string {
  if (server.reachable) {
    return server.usableModels > 0
      ? `${server.usableModels} model${server.usableModels === 1 ? "" : "s"}`
      : "Running";
  }
  return server.endpoint ? "Not running" : idle;
}

function Logo({ provider }: { provider: AuthProvider }): React.ReactElement {
  const logo = providerLogo(provider.value);
  return logo ? (
    <img className="pv-logo" src={logo} alt="" />
  ) : (
    <span className="pv-logo-letter" aria-hidden="true">
      {provider.label.charAt(0)}
    </span>
  );
}

interface PrivateNode {
  key: string;
  name: string;
  words: string;
  /** Whether it answers; `null` for an action, which has no state to mark. */
  on: boolean | null;
  title: string;
  logo: React.ReactNode;
  open: () => void;
}

export function ProvidersPage(): React.ReactElement {
  const [providers, setProviders] = useState<AuthProvider[]>([]);
  const [local, setLocal] = useState<LocalModelsState>({ endpoints: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [active, setActive] = useState<AuthProvider | null>(null);
  const [localOpen, setLocalOpen] = useState(false);
  // Swapped in place (never stacked) so Escape closes exactly one dialog.
  const [hfOpen, setHfOpen] = useState(false);
  const addId = useId();
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
    // Keep the open dialog's provider current (its connected state).
    setActive((cur) => (cur ? (list.find((p) => p.value === cur.value) ?? cur) : cur));
  }, [load]);

  const refreshLocal = useCallback(async (): Promise<void> => {
    setLocal(await getLocalModels());
  }, []);

  useEffect(() => {
    let cancelled = false;
    void authStatusWithError()
      .then((status) => {
        if (cancelled) return;
        setProviders(status.providers);
        setError(status.error);
        setLoading(false);
      })
      .catch(() => {
        if (!cancelled) setLoading(false);
      });
    void getLocalModels().then((state) => {
      if (!cancelled) setLocal(state);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Signing in or out in any window, or a rescan on the host, changes what this shows.
  useEffect(() => {
    const unsub = subscribe((e: SidecarEvent) => {
      if (e.type === "auth_change") void refresh();
      if (e.type === "models_change") void refreshLocal();
    });
    return () => unsub();
  }, [refresh, refreshLocal]);

  const servers = privateServers(local);
  const privateReady = [servers.tinfoil, servers.ollama].filter((s) => s.reachable).length;
  const connected = providers.filter((p) => p.connected);
  const toAdd = providers.filter((p) => !p.connected);
  const connectedCount = connected.length + privateReady;
  // Whether the cloud list was read: until it is, nothing is said about where messages go.
  const known = !loading && !(error && providers.length === 0);

  const inside: PrivateNode[] = [
    {
      key: "tinfoil",
      name: "Tinfoil",
      words: serverWords(servers.tinfoil, "Set up on host"),
      on: servers.tinfoil.reachable,
      title: "Tinfoil — private AI in secure hardware, set up on your host",
      logo: <ShieldCheckIcon size={22} weight="light" aria-hidden="true" />,
      open: () => setLocalOpen(true),
    },
    {
      key: "ollama",
      name: "Ollama",
      words: serverWords(servers.ollama, "No key needed"),
      on: servers.ollama.reachable,
      title: "Ollama — models running on your host",
      logo: <img className="pv-logo" src={providerLogo("ollama")} alt="" />,
      open: () => setLocalOpen(true),
    },
    {
      // An action, not a server: it has no state, so it carries no mark.
      key: "hf-local",
      name: "Hugging Face",
      words: "Download models",
      on: null,
      title: "Hugging Face — download models to Ollama",
      logo: <img className="pv-logo" src={providerLogo("huggingface")} alt="" />,
      open: () => setHfOpen(true),
    },
  ];

  return (
    <div className="pv-page">
      <SettingsHeaderStatus>
        {loading ? null : (
          <Badge color={connectedCount > 0 ? theme.success : undefined}>
            {`${connectedCount} connected`}
          </Badge>
        )}
      </SettingsHeaderStatus>

      {/* Either side of the ring, a connected provider takes a row: the ring spans them all. */}
      <div
        className="pv-boundary"
        style={{ "--pv-rows": Math.max(1, Math.ceil(connected.length / 2)) } as React.CSSProperties}
      >
        <div className="pv-ring-wrap">
          <span className="pv-ring" aria-hidden="true" />
          {/* The list below carries the name for a screen reader. */}
          <p className="st-label pv-ring-label" aria-hidden="true">
            Private
          </p>
          <div className="pv-core" aria-hidden="true">
            <KleioMark small />
          </div>
          <ul className="pv-inside" aria-label="Private models">
            {inside.map((node) => (
              <li key={node.key}>
                <button
                  type="button"
                  className="pv-node pv-in"
                  title={node.title}
                  aria-label={`${node.name}: ${node.words}`}
                  onClick={node.open}
                >
                  <span className="pv-orb">
                    {node.logo}
                    {node.on !== null && (
                      <span className={`pv-dot${node.on ? " is-on" : ""}`} aria-hidden="true" />
                    )}
                  </span>
                  <span className="pv-name">{node.name}</span>
                  <span className="pv-status">{node.words}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>

        {connected.length > 0 && (
          <ul className="pv-outside" aria-label="Connected cloud providers">
            {connected.map((p) => {
              const methods = p.connectedMethods ?? [];
              return (
                <li key={p.value}>
                  <button
                    type="button"
                    className="pv-node pv-out"
                    aria-label={`${p.label}: connected with ${methods.map((m) => METHOD_LABEL[m]).join(" and ")}. Manage`}
                    onClick={() => setActive(p)}
                  >
                    <span className="pv-orb">
                      <Logo provider={p} />
                      <span className="pv-dot is-on" aria-hidden="true" />
                    </span>
                    <span className="pv-node-text">
                      <span className="pv-name">{p.label}</span>
                      <span className="pv-how">
                        {methods.map((m, i) => (
                          <Fragment key={m}>
                            {i > 0 && " · "}
                            <span
                              title={
                                p.activeMethod === m
                                  ? `${METHOD_LABEL[m]} — connected, in use`
                                  : `${METHOD_LABEL[m]} — connected, standby`
                              }
                            >
                              {METHOD_LABEL[m]}
                            </span>
                          </Fragment>
                        ))}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <p className="pv-caption">
        {!known
          ? PRIVATE_LINE
          : connected.length > 0
            ? `${PRIVATE_LINE} Outside it, your messages go to the company you picked.`
            : `${PRIVATE_LINE} Nothing goes to a cloud provider yet.`}
      </p>

      <section className="pv-add" aria-labelledby={addId}>
        <h2 className="st-label" id={addId}>
          Add a provider
        </h2>
        {loading ? (
          <p className="pv-add-line">Checking providers…</p>
        ) : error && providers.length === 0 ? (
          // A fault, marked as one: the words say why.
          <p className="pv-add-line is-fault" role="status">
            {error}
          </p>
        ) : toAdd.length === 0 ? (
          <p className="pv-add-line">Every cloud provider is connected.</p>
        ) : (
          <ul className="pv-add-list">
            {toAdd.map((p) => {
              const how = p.methods.map((m) => METHOD_LABEL[m]).join(" or ");
              return (
                <li key={p.value}>
                  <button
                    type="button"
                    className="pv-add-row"
                    aria-label={`Add ${p.label}, with ${how}`}
                    onClick={() => setActive(p)}
                  >
                    <span className="pv-add-logo">
                      <Logo provider={p} />
                    </span>
                    <span className="pv-add-name">{p.label}</span>
                    <span className="pv-add-how">{how}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>

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

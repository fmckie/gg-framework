// Kleio's home screen: Ken's layout, entry animation and dithered waves (his
// HomeScreen stays in the tree, unused, so upstream syncs stay easy), dressed
// in Kleio's crimson and white, with Kleio's own ways in.

import { useEffect, useState } from "react";
import {
  CirclesThreeIcon,
  CodeIcon,
  DownloadSimpleIcon,
  GearSixIcon,
  SparkleIcon,
} from "@phosphor-icons/react";
import { getVersion } from "@tauri-apps/api/app";
import { HomeDither } from "../HomeDither";
import { useHomeBackgroundEnabled } from "../home-background";
import type { SettingsTabId } from "../SettingsScreen";
import { authStatus, getLocalModels, getSettings, waitForReady } from "../agent";
import { toast } from "../toast";
import { useAppUpdate } from "../update";
import { KleioMark } from "./KleioMark";
import { hasUsableLocalModel } from "./privateModels";
import { useKleioRemote } from "./useKleioRemote";

/** Deep crimson waves on the warm near-black (RGB 0–1). The dither snaps each
 * channel to a few levels, so a brighter red turns into loud, saturated dots;
 * this stays a quiet backdrop behind the text, as Ken's grey does. */
const KLEIO_WAVES = [0.22, 0.03, 0.05] as const;
const KLEIO_BACKGROUND = [0.047, 0.035, 0.039] as const;

interface Props {
  /** Chat with Kleio: upstream's Chat screen (the general agent), on the Mac mini. */
  onChat: () => void;
  /** Coding projects on the Mac mini. */
  onCode: () => void;
  /** Kleio's specialists ("Blobs" in the code and on the host). Apps live in Settings. */
  onBlobs: () => void;
  onSettings: (tab?: SettingsTabId) => void;
  refreshSignal?: number;
}

/** "mac-mini-1.tailnet.ts.net" → "mac-mini-1". */
export function shortHost(host: string): string {
  return host.split(".")[0] || host;
}

export function KleioHome({
  onChat,
  onCode,
  onBlobs,
  onSettings,
  refreshSignal = 0,
}: Props): React.ReactElement {
  const { status } = useKleioRemote();
  const [ready, setReady] = useState<{ folder: boolean; model: boolean } | null>(null);
  const [version, setVersion] = useState<string | null>(null);
  const appUpdate = useAppUpdate();
  const backgroundOn = useHomeBackgroundEnabled();

  useEffect(() => {
    void getVersion()
      .then(setVersion)
      .catch(() => {});
  }, []);

  // Chat and Code need a model on the Mac mini: a signed-in provider, or a
  // private one (Tinfoil, Ollama) that is running. Code also needs a projects
  // folder. Unknown (the host didn't answer yet) never blocks: the next screen
  // explains.
  async function refresh(): Promise<void> {
    await waitForReady().catch(() => {});
    const [settings, providers, local] = await Promise.all([
      getSettings().catch(() => null),
      authStatus().catch(() => null),
      getLocalModels().catch(() => null),
    ]);
    const signedIn = providers ? providers.some((p) => p.connected) : null;
    const localReady = local ? hasUsableLocalModel(local) : null;
    setReady({
      folder: settings ? (settings.configured ?? Boolean(settings.projectsRoot)) : true,
      model: signedIn === true || localReady === true || (signedIn === null && localReady === null),
    });
  }

  useEffect(() => {
    void refresh();
    const onFocus = (): void => void refresh();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, []);

  useEffect(() => {
    if (refreshSignal > 0) void refresh();
  }, [refreshSignal]);

  const modelReady = ready === null || ready.model;
  const codeReady = ready === null || (ready.folder && ready.model);

  function needModel(): void {
    toast("Connect an AI model first.", "warning");
    onSettings("providers");
  }

  function openChat(): void {
    if (modelReady) return onChat();
    needModel();
  }

  function openCode(): void {
    if (codeReady) return onCode();
    if (!ready?.model) return needModel();
    toast("Set a projects folder on your Mac mini first.", "warning");
    onSettings("general");
  }

  const host = status?.active?.host;

  return (
    <div className="home kleio-home" data-tauri-drag-region>
      {backgroundOn && <HomeDither waveColor={KLEIO_WAVES} backgroundColor={KLEIO_BACKGROUND} />}
      <div className="home-version-row">
        <button
          type="button"
          className="kleio-status"
          title="Connection to your Mac mini"
          onClick={() => onSettings("connection")}
        >
          <span className="kleio-status-dot" aria-hidden="true" />
          {host ? `Connected to ${shortHost(host)}` : "Connected to your Mac mini"}
        </button>
      </div>
      <KleioMark />
      <div className="home-tagline">
        Your private assistant, specialists and coder, in one place.
      </div>
      <div className="home-actions">
        <button
          type="button"
          className={`btn btn-primary home-action${modelReady ? "" : " is-dimmed"}`}
          aria-disabled={modelReady ? undefined : true}
          onClick={openChat}
        >
          <SparkleIcon size={18} weight="bold" aria-hidden="true" />
          Kleio
        </button>
        <button
          type="button"
          className={`btn btn-ghost home-action${codeReady ? "" : " is-dimmed"}`}
          aria-disabled={codeReady ? undefined : true}
          onClick={openCode}
        >
          <CodeIcon size={18} weight="bold" aria-hidden="true" />
          Code
        </button>
        <button type="button" className="btn btn-ghost home-action" onClick={onBlobs}>
          <CirclesThreeIcon size={18} weight="bold" aria-hidden="true" />
          Specialists
        </button>
      </div>
      <button
        type="button"
        className="icon-circle home-settings"
        aria-label="Settings"
        title="Settings"
        onClick={() => onSettings()}
      >
        <GearSixIcon size={20} weight="bold" aria-hidden="true" />
      </button>
      <div className="home-version-corner">
        {appUpdate.phase === "available" || appUpdate.phase === "installing" ? (
          <button
            className={`home-update${appUpdate.phase === "installing" ? " home-update-progress" : ""}`}
            disabled={appUpdate.phase === "installing"}
            title={`Update to ${appUpdate.version} — installs and restarts Kleio`}
            onClick={() => void appUpdate.install()}
          >
            {appUpdate.phase === "installing" && (
              <span className="home-update-fill" style={{ width: `${appUpdate.progress ?? 0}%` }} />
            )}
            <DownloadSimpleIcon size={14} weight="bold" aria-hidden="true" />
            {appUpdate.phase === "installing"
              ? `Installing… ${appUpdate.progress ?? 0}%`
              : `Update to ${appUpdate.version}`}
          </button>
        ) : (
          version && <span className="home-version">{`v${version}`}</span>
        )}
      </div>
    </div>
  );
}

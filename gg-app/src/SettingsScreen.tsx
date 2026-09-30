import { useEffect, useState } from "react";
import {
  GearSixIcon,
  KeyIcon,
  PuzzlePieceIcon,
  ShareNetworkIcon,
  SyringeIcon,
} from "@phosphor-icons/react";
import { BackButton } from "./BackButton";
import { EmbeddedModal } from "./modal-embed";
import { SettingsModal } from "./SettingsModal";
import { LoginScreen } from "./LoginScreen";
import { McpModal } from "./McpModal";
import { SteroidsModal } from "./SteroidsModal";
import { ConnectionPage } from "./kleio/LazyConnectionPage";
import { SettingsTabBar, type SettingsTab } from "./SettingsTabBar";
import { SettingsHeaderProvider } from "./settings-header";
import { waitForReady, getSteroidsStatus, onSteroidsChange, type SteroidsStatus } from "./agent";
import { toast } from "./toast";

export type SettingsTabId = "general" | "providers" | "connection" | "mcp" | "steroids";

interface Props {
  onClose: () => void;
  /** The tab to open on, e.g. AI Providers when Code needs a provider. */
  initialTab?: SettingsTabId;
}

const PANEL_ID = "settings-panel";

/**
 * Full-screen Settings, reached from the home screen's Settings button. One
 * page per section, switched with yaatuber's floating tab capsule at the
 * bottom. Each page is the same panel the app still opens as a dialog from the
 * tray and the chat view, drawn here in page form (see modal-embed.tsx).
 */
export function SettingsScreen({ onClose, initialTab = "general" }: Props): React.ReactElement {
  const [tab, setTab] = useState<SettingsTabId>(initialTab);
  const [steroids, setSteroids] = useState<SteroidsStatus | null>(null);
  // The header elements pages portal their status and buttons into
  // (settings-header.tsx).
  const [statusSlot, setStatusSlot] = useState<HTMLSpanElement | null>(null);
  const [actionsSlot, setActionsSlot] = useState<HTMLSpanElement | null>(null);
  // The first page rises in like the other screens' rows; later tab switches
  // crossfade, as in yaatuber's settings.
  const [switched, setSwitched] = useState(false);

  useEffect(() => {
    void waitForReady()
      .then(() => getSteroidsStatus())
      .then(setSteroids)
      .catch(() => {});
    return onSteroidsChange(setSteroids);
  }, []);

  const tabs: SettingsTab<SettingsTabId>[] = [
    { id: "general", label: "General", icon: GearSixIcon },
    { id: "providers", label: "AI Providers", icon: KeyIcon },
    // kleio: the Mac mini, Tailscale and the iPhone app take the place of
    // upstream's Telegram "Remote" page (the phone app is Kleio's remote).
    { id: "connection", label: "Connection", icon: ShareNetworkIcon },
    { id: "mcp", label: "MCP", icon: PuzzlePieceIcon },
    {
      id: "steroids",
      label: "Steroids",
      icon: SyringeIcon,
      alert: steroids !== null && !steroids.connected,
    },
  ];

  const current = tabs.find((t) => t.id === tab);

  // Pages stay put after their own Save/Close (the Back button leaves).
  const stay = (): void => {};

  function selectTab(id: SettingsTabId): void {
    setSwitched(true);
    setTab(id);
  }

  return (
    <div className="picker settings-screen">
      <div className="picker-head" data-tauri-drag-region>
        <BackButton label="Back" onClick={onClose} />
        {/* Names the open page; each page's own heading is hidden to match. */}
        <h1 className="picker-title">{current?.label ?? "Settings"}</h1>
        <span className="settings-head-status" ref={setStatusSlot} />
        {/* The open page's buttons, right-aligned on the header's row. */}
        <span className="picker-head-actions settings-head-actions" ref={setActionsSlot} />
      </div>

      <div
        className="settings-scroll"
        id={PANEL_ID}
        role="tabpanel"
        aria-labelledby={`settings-tab-${tab}`}
        // Remount per tab so each page loads fresh and scroll starts at the top.
        key={tab}
      >
        <SettingsHeaderProvider slots={{ status: statusSlot, actions: actionsSlot }}>
          <div className={`settings-page ${switched ? "is-switching" : "is-entering"}`}>
            {tab === "general" && (
              <EmbeddedModal>
                <SettingsModal
                  onClose={stay}
                  onSaved={() => toast("Project folder saved.", "success")}
                />
              </EmbeddedModal>
            )}
            {tab === "providers" && <LoginScreen />}
            {tab === "connection" && <ConnectionPage />}
            {tab === "mcp" && (
              <EmbeddedModal>
                <McpModal onClose={stay} />
              </EmbeddedModal>
            )}
            {tab === "steroids" && (
              <EmbeddedModal>
                <SteroidsModal status={steroids} onStatus={setSteroids} onClose={stay} />
              </EmbeddedModal>
            )}
          </div>
        </SettingsHeaderProvider>
      </div>

      <SettingsTabBar tabs={tabs} selected={tab} onSelect={selectTab} panelId={PANEL_ID} />
    </div>
  );
}

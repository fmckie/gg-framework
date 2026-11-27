// kleio: the one place Settings' two layouts part ways. The phone keeps today's
// eight tabs, its Setup page, its General page (SettingsModal), its AI Providers
// page (LoginScreen), its MCP page (McpModal), its Steroids page (SteroidsModal)
// and About's card. The desktop relabels Setup to Overview and MCP to Tools (the
// ids stay, so deep links still land), adds the Kleio tab second, draws General
// as the folder over a quiet row (GeneralPage), AI Providers as the ring
// (ProvidersPage), Tools as the workbench (ToolsPage), Steroids as one section
// (SteroidsPage) and About as the maker's page (AboutPage picks it), and shows
// Steroids' dot only for a fault.

import { PulseIcon, SparkleIcon } from "@phosphor-icons/react";
import type { SteroidsStatus } from "../agent";
import { LoginScreen } from "../LoginScreen";
import { McpModal } from "../McpModal";
import { EmbeddedModal } from "../modal-embed";
import { isPhone } from "../platform";
import { SettingsModal } from "../SettingsModal";
import type { SettingsTabId } from "../SettingsScreen";
import type { SettingsTab } from "../SettingsTabBar";
import { SteroidsModal } from "../SteroidsModal";
import { toast } from "../toast";
import { AboutPage } from "./AboutPage";
import { GeneralPage } from "./GeneralPage";
import { KleioPage } from "./KleioPage";
import { OverviewPage } from "./OverviewPage";
import { ProvidersPage } from "./ProvidersPage";
import { SetupPage } from "./SetupPage";
import { SteroidsPage } from "./SteroidsPage";
import { ToolsPage } from "./ToolsPage";

/** The tab bar's tabs for this device, from the screen's own list. */
export function kleioSettingsTabs(
  tabs: SettingsTab<SettingsTabId>[],
  steroids: SteroidsStatus | null,
): SettingsTab<SettingsTabId>[] {
  if (isPhone()) return tabs;
  return tabs.flatMap((tab): SettingsTab<SettingsTabId>[] => {
    if (tab.id === "setup")
      return [
        // The landing page, and the only place health is summarised.
        { ...tab, label: "Overview", icon: PulseIcon },
        // Voice, what she remembers, Dictation and Group chats, edited here.
        { id: "kleio", label: "Kleio", icon: SparkleIcon },
      ];
    if (tab.id === "mcp") return [{ ...tab, label: "Tools" }];
    if (tab.id === "steroids")
      return [
        {
          ...tab,
          // Only a fault: installed but failing. Not installed is optional, and
          // an empty corpus is a next step.
          alert:
            steroids !== null &&
            steroids.installed &&
            !steroids.connected &&
            Boolean(steroids.error),
        },
      ];
    return [tab];
  });
}

// A page stays put: only the screen's Back button leaves.
const stay = (): void => {};
const folderSaved = (): void => {
  toast("Project folder saved.", "success");
};

/** The page for every tab but Connection and Apps. */
export function KleioSettingsPage({
  tab,
  onOpenTab,
  onIntroduce,
  steroids,
  onSteroids,
}: {
  tab: Exclude<SettingsTabId, "connection" | "apps">;
  onOpenTab: (tab: SettingsTabId) => void;
  /** Starts the Introduce-yourself chat. */
  onIntroduce: () => Promise<void>;
  /** Steroids' status, held by the screen for the tab's dot. */
  steroids: SteroidsStatus | null;
  onSteroids: (status: SteroidsStatus) => void;
}): React.ReactElement {
  if (tab === "general")
    return isPhone() ? (
      <EmbeddedModal>
        <SettingsModal onClose={stay} onSaved={folderSaved} />
      </EmbeddedModal>
    ) : (
      <GeneralPage onSaved={folderSaved} />
    );
  if (tab === "providers") return isPhone() ? <LoginScreen /> : <ProvidersPage />;
  if (tab === "mcp")
    return isPhone() ? (
      <EmbeddedModal>
        <McpModal onClose={stay} />
      </EmbeddedModal>
    ) : (
      <ToolsPage />
    );
  if (tab === "steroids")
    return isPhone() ? (
      <EmbeddedModal>
        <SteroidsModal status={steroids} onStatus={onSteroids} onClose={stay} />
      </EmbeddedModal>
    ) : (
      <SteroidsPage status={steroids} onStatus={onSteroids} />
    );
  // One entry for both layouts: it reads the version, then draws its own.
  if (tab === "about") return <AboutPage />;
  // The phone has no Kleio tab; should anything ask for it there, Setup has its cards.
  if (isPhone()) return <SetupPage onOpenTab={onOpenTab} onIntroduce={onIntroduce} />;
  return tab === "kleio" ? (
    <KleioPage onOpenTab={onOpenTab} onIntroduce={onIntroduce} />
  ) : (
    <OverviewPage onOpenTab={onOpenTab} />
  );
}

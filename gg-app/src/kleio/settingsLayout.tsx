// kleio: Settings' tabs and pages, the same on the desktop and the iPhone. Setup
// is relabelled Overview and MCP Tools (the ids stay, so deep links still land),
// the Kleio tab comes second, General is the folder over a quiet row
// (GeneralPage), AI Providers the ring (ProvidersPage), Tools the workbench
// (ToolsPage), Steroids one section (SteroidsPage) and About the maker's page
// (AboutPage). Steroids' dot shows only for a fault.

import { PulseIcon, SparkleIcon } from "@phosphor-icons/react";
import type { SteroidsStatus } from "../agent";
import type { SettingsTabId } from "../SettingsScreen";
import type { SettingsTab } from "../SettingsTabBar";
import { toast } from "../toast";
import { AboutPage } from "./AboutPage";
import { GeneralPage } from "./GeneralPage";
import { KleioPage } from "./KleioPage";
import { OverviewPage } from "./OverviewPage";
import { ProvidersPage } from "./ProvidersPage";
import { SteroidsPage } from "./SteroidsPage";
import { ToolsPage } from "./ToolsPage";

/** The tab bar's tabs, from the screen's own list. */
export function kleioSettingsTabs(
  tabs: SettingsTab<SettingsTabId>[],
  steroids: SteroidsStatus | null,
): SettingsTab<SettingsTabId>[] {
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
  if (tab === "general") return <GeneralPage onSaved={folderSaved} />;
  if (tab === "providers") return <ProvidersPage />;
  if (tab === "mcp") return <ToolsPage />;
  if (tab === "steroids") return <SteroidsPage status={steroids} onStatus={onSteroids} />;
  if (tab === "about") return <AboutPage />;
  return tab === "kleio" ? (
    <KleioPage onOpenTab={onOpenTab} onIntroduce={onIntroduce} />
  ) : (
    <OverviewPage onOpenTab={onOpenTab} />
  );
}

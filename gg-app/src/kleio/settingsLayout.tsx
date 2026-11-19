// kleio: the one place Settings' two layouts part ways. The phone keeps today's
// eight tabs and its Setup page. The desktop relabels Setup to Overview and MCP
// to Tools (the ids stay, so deep links still land), adds the Kleio tab second,
// and shows Steroids' dot only for a fault.

import { PulseIcon, SparkleIcon } from "@phosphor-icons/react";
import type { SteroidsStatus } from "../agent";
import { isPhone } from "../platform";
import type { SettingsTabId } from "../SettingsScreen";
import type { SettingsTab } from "../SettingsTabBar";
import { KleioPage } from "./KleioPage";
import { OverviewPage } from "./OverviewPage";
import { SetupPage } from "./SetupPage";

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

/** The page for the `setup` and `kleio` tabs. */
export function KleioSettingsPage({
  tab,
  onOpenTab,
  onIntroduce,
}: {
  tab: "setup" | "kleio";
  onOpenTab: (tab: SettingsTabId) => void;
  /** Starts the Introduce-yourself chat. */
  onIntroduce: () => Promise<void>;
}): React.ReactElement {
  // The phone has no Kleio tab; should anything ask for it there, Setup has its cards.
  if (isPhone()) return <SetupPage onOpenTab={onOpenTab} onIntroduce={onIntroduce} />;
  return tab === "kleio" ? (
    <KleioPage onOpenTab={onOpenTab} onIntroduce={onIntroduce} />
  ) : (
    <OverviewPage onOpenTab={onOpenTab} />
  );
}

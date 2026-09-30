// Kleio's own full-screen pages — Agents (Blobs, in the code and on the host)
// and Groups — built like Ken's Settings screen: a header with Back and the
// page's name, a scrolling body of glass cards, and the capsule tab bar at the
// bottom. Everything comes from the Kleio host (the Mac mini), so the phone and
// every Mac stay in sync. Apps moved to Settings.

import { useState } from "react";
import { ChatsCircleIcon, CirclesThreeIcon } from "@phosphor-icons/react";
import { BackButton } from "../BackButton";
import { SettingsHeaderProvider } from "../settings-header";
import { SettingsTabBar, type SettingsTab } from "../SettingsTabBar";
import { BlobsPage } from "./BlobsPage";
import { GroupsPage } from "./GroupsPage";

export type KleioScreenTab = "blobs" | "groups";

const PANEL_ID = "kleio-screen-panel";

const TABS: SettingsTab<KleioScreenTab>[] = [
  { id: "blobs", label: "Agents", icon: CirclesThreeIcon },
  { id: "groups", label: "Groups", icon: ChatsCircleIcon },
];

interface Props {
  initialTab?: KleioScreenTab;
  onClose: () => void;
}

export function KleioScreen({ initialTab = "blobs", onClose }: Props): React.ReactElement {
  const [tab, setTab] = useState<KleioScreenTab>(initialTab);
  const [statusSlot, setStatusSlot] = useState<HTMLSpanElement | null>(null);
  const [actionsSlot, setActionsSlot] = useState<HTMLSpanElement | null>(null);
  // The first page rises in; later tab switches crossfade (as in Settings).
  const [switched, setSwitched] = useState(false);
  const current = TABS.find((t) => t.id === tab);

  function selectTab(id: KleioScreenTab): void {
    setSwitched(true);
    setTab(id);
  }

  return (
    <div className="picker settings-screen kleio-screen">
      <div className="picker-head" data-tauri-drag-region>
        <BackButton label="Back" onClick={onClose} />
        <h1 className="picker-title">{current?.label ?? "Kleio"}</h1>
        <span className="settings-head-status" ref={setStatusSlot} />
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
            {tab === "blobs" && <BlobsPage />}
            {tab === "groups" && <GroupsPage />}
          </div>
        </SettingsHeaderProvider>
      </div>

      <SettingsTabBar tabs={TABS} selected={tab} onSelect={selectTab} panelId={PANEL_ID} />
    </div>
  );
}

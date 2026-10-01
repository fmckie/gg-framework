// Kleio's Agents and Groups, laid out like the Chats and Code pickers: each
// page draws the shared picker header and a list; an agent or group opens into
// its chat with a sidebar of cards, and new/edit are full-page forms. The
// capsule switcher between Agents and Groups shows on the two lists only.
// Everything comes from the Kleio host (the Mac mini), so the phone and every
// Mac stay in sync.

import { useState } from "react";
import { ChatsCircleIcon, CirclesThreeIcon } from "@phosphor-icons/react";
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
  // A page reports when it's on its list, the only place the switcher shows.
  const [atList, setAtList] = useState(true);

  return (
    <div className={`picker kleio-screen${atList ? " has-dock" : ""}`}>
      <div
        className="kleio-page"
        id={PANEL_ID}
        {...(atList ? { role: "tabpanel", "aria-labelledby": `settings-tab-${tab}` } : {})}
        // Remount per tab so each page loads fresh and opens on its list.
        key={tab}
      >
        {tab === "blobs" ? (
          <BlobsPage onClose={onClose} onListChange={setAtList} />
        ) : (
          <GroupsPage onClose={onClose} onListChange={setAtList} />
        )}
      </div>
      {atList && <SettingsTabBar tabs={TABS} selected={tab} onSelect={setTab} panelId={PANEL_ID} />}
    </div>
  );
}

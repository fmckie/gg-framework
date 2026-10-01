// Kleio's Agents and Groups, laid out like the Chats and Code pickers: each
// page draws the shared picker header and a list; an agent or group opens into
// its chat with a sidebar of cards, and new/edit are full-page forms. The
// capsule switcher between Agents and Groups shows on the two lists only.
// "Connect apps" on either list opens the Apps page here, with Back returning
// to the list. Everything comes from the Kleio host (the Mac mini), so the
// phone and every Mac stay in sync.

import { useState } from "react";
import { ChatsCircleIcon, CirclesThreeIcon } from "@phosphor-icons/react";
import { SettingsHeaderProvider } from "../settings-header";
import { SettingsTabBar, type SettingsTab } from "../SettingsTabBar";
import { BlobsPage } from "./BlobsPage";
import { GroupsPage } from "./GroupsPage";
import { KleioHead } from "./KleioChrome";
import { AppsPage } from "./LazyAppsPage";

export type KleioScreenTab = "blobs" | "groups";

const PANEL_ID = "kleio-screen-panel";

const TABS: SettingsTab<KleioScreenTab>[] = [
  { id: "blobs", label: "Agents", icon: CirclesThreeIcon },
  { id: "groups", label: "Groups", icon: ChatsCircleIcon },
];

interface Props {
  initialTab?: KleioScreenTab;
  /** Open straight into this agent's or group's chat, on `initialTab`. The
   *  screen remounts per tab, so switching tabs lands on the lists as usual. */
  openId?: string;
  onClose: () => void;
}

/** The Settings Apps page, under Kleio's own header. Its "N connected" badge
 *  portals into the header the way it does in Settings. */
function KleioApps({ onBack }: { onBack: () => void }): React.ReactElement {
  const [statusSlot, setStatusSlot] = useState<HTMLElement | null>(null);
  return (
    <>
      <KleioHead
        onBack={onBack}
        title="Apps"
        status={<span className="settings-head-status" ref={setStatusSlot} />}
      />
      <div className="settings-scroll">
        <SettingsHeaderProvider slots={{ status: statusSlot, actions: null }}>
          <div className="settings-page is-entering">
            <AppsPage />
          </div>
        </SettingsHeaderProvider>
      </div>
    </>
  );
}

export function KleioScreen({ initialTab = "blobs", openId, onClose }: Props): React.ReactElement {
  const [tab, setTab] = useState<KleioScreenTab>(initialTab);
  const [apps, setApps] = useState(false);
  // A page reports when it's on its list, the only place the switcher shows.
  const [atList, setAtList] = useState(!openId);
  // Open straight into the item once. Pages remount per tab, so coming back
  // to this tab later lands on its list like any other visit.
  const [pending, setPending] = useState(openId);
  const open = pending ? { openId: pending } : {};
  const switchTab = (next: KleioScreenTab): void => {
    setPending(undefined);
    setTab(next);
  };
  const dock = atList && !apps;
  const openApps = (): void => setApps(true);

  return (
    <div className={`picker kleio-screen${dock ? " has-dock" : ""}`}>
      <div
        className="kleio-page"
        id={PANEL_ID}
        {...(dock ? { role: "tabpanel", "aria-labelledby": `settings-tab-${tab}` } : {})}
        // Remount per tab (and on leaving Apps) so each page loads fresh and
        // opens on its list.
        key={apps ? "apps" : tab}
      >
        {apps ? (
          <KleioApps
            onBack={() => {
              setPending(undefined);
              setApps(false);
            }}
          />
        ) : tab === "blobs" ? (
          <BlobsPage onClose={onClose} onListChange={setAtList} onOpenApps={openApps} {...open} />
        ) : (
          <GroupsPage onClose={onClose} onListChange={setAtList} onOpenApps={openApps} {...open} />
        )}
      </div>
      {dock && (
        <SettingsTabBar tabs={TABS} selected={tab} onSelect={switchTab} panelId={PANEL_ID} />
      )}
    </div>
  );
}

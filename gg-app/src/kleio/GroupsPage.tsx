// Groups: a group chat with several specialists at once, from the Kleio host.
// The list is the Cast's shelf (CastGroups.tsx), new and edit its form
// (CastGroupForm.tsx) and a group's chat its room (CastRoom.tsx), on the desktop
// and the iPhone alike. A group's picture is its members' blobs.

import { useCallback, useEffect, useState } from "react";
import { theme } from "../theme";
import { CastGroupForm } from "./CastGroupForm";
import { CastGroups } from "./CastGroups";
import { CastRoom } from "./CastRoom";
import { KleioHead } from "./KleioChrome";
import { listBlobs, listGroups, errorText, type Blob, type Group } from "./kleioApi";

const LIST_REFRESH_MS = 10_000;

type View =
  | { kind: "list" }
  | { kind: "chat"; id: string }
  // `from`: where Cancel goes back to. The list can open the form itself.
  | { kind: "form"; id: string | null; from?: "list" };

export function GroupsPage({
  onClose,
  onListChange,
  onOpenApps,
  openId,
}: {
  /** Leave Groups (Back on the list). */
  onClose: () => void;
  /** Told whether the list is showing, so the screen can show its switcher. */
  onListChange?: (atList: boolean) => void;
  /** Open the Apps page (a "Connect apps" button on the list). */
  onOpenApps?: () => void;
  /** Open straight into this group's chat (a tapped notification). */
  openId?: string;
}): React.ReactElement {
  const [groups, setGroups] = useState<Group[] | null>(null);
  const [blobs, setBlobs] = useState<Blob[]>([]);
  const [view, setView] = useState<View>(openId ? { kind: "chat", id: openId } : { kind: "list" });
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [g, b] = await Promise.all([listGroups(), listBlobs()]);
      setGroups(g);
      setBlobs(b);
      setError(null);
    } catch (e) {
      setError(errorText(e));
    }
  }, []);
  useEffect(() => {
    void load();
    const id = window.setInterval(() => void load(), LIST_REFRESH_MS);
    return () => window.clearInterval(id);
  }, [load]);

  useEffect(() => {
    onListChange?.(view.kind === "list");
  }, [view.kind, onListChange]);

  const toList = (): void => {
    setView({ kind: "list" });
    void load();
  };

  if (view.kind === "form") {
    const group = view.id ? groups?.find((g) => g.id === view.id) : undefined;
    const fromList = view.from === "list";
    return (
      <CastGroupForm
        {...(group ? { group } : {})}
        blobs={blobs}
        onCancel={() =>
          setView(group && !fromList ? { kind: "chat", id: group.id } : { kind: "list" })
        }
        onSaved={(g) => {
          setView({ kind: "chat", id: g.id });
          void load();
        }}
        onDeleted={toList}
      />
    );
  }

  if (view.kind === "chat") {
    const group = groups?.find((g) => g.id === view.id);
    if (group) {
      return (
        <CastRoom
          group={group}
          blobs={blobs}
          onBack={toList}
          onEdit={() => setView({ kind: "form", id: group.id })}
        />
      );
    }
    if (groups === null)
      return (
        <>
          <KleioHead onBack={toList} title="Groups" />
          <div className="picker-empty" style={{ color: theme.textMuted }}>
            Loading…
          </div>
        </>
      );
  }

  const list = {
    groups,
    blobs,
    error,
    onClose,
    onCreate: () => setView({ kind: "form", id: null }),
    onOpen: (id: string) => setView({ kind: "chat", id }),
    ...(onOpenApps ? { onOpenApps } : {}),
  };
  // Each group stands on the shelf.
  return <CastGroups {...list} onEdit={(id) => setView({ kind: "form", id, from: "list" })} />;
}

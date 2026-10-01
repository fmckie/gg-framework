import { useEffect, useState } from "react";
import { Badge } from "./Badge";
import { Modal } from "./Modal";
import { ListSkeleton } from "./Skeleton";
import { listHostProjectFolders, type HostProjectFolder } from "./agent";

interface Props {
  /** The Kleio host's name, for the title. */
  host: string;
  onClose: () => void;
  /** Open this folder (it may be hidden from the project list). */
  onPick: (folder: HostProjectFolder) => void;
}

/**
 * "Open existing" while paired with a Kleio host: this Mac's Finder can't see
 * the host's disk, so pick from the folders in the host's projects folders.
 * Hidden ones are listed too and say so, so hiding never loses a project.
 */
export function HostFoldersModal({ host, onClose, onPick }: Props): React.ReactElement {
  const [folders, setFolders] = useState<HostProjectFolder[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    listHostProjectFolders()
      .then((list) => {
        if (!cancelled) setFolders(list);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <Modal title={`Open a project on ${host}`} onClose={onClose} className="host-folders-modal">
      {error ? (
        <p className="modal-error" role="alert">
          {error}
        </p>
      ) : folders === null ? (
        <ListSkeleton rows={4} />
      ) : folders.length === 0 ? (
        <p className="modal-hint">No project folders yet. Use New project to make one.</p>
      ) : (
        <ul className="host-folders-list">
          {folders.map((f) => (
            <li key={f.path}>
              <button
                type="button"
                className="picker-item"
                title={f.path}
                onClick={() => onPick(f)}
              >
                <span className="picker-row">
                  <span className="picker-name">{f.name}</span>
                  {f.hidden && <Badge>Hidden</Badge>}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}

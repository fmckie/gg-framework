import { FolderSimpleIcon, MinusCircleIcon } from "@phosphor-icons/react";
import { folderPlace } from "./HostFoldersModal";
import { Modal } from "./Modal";

/** What /remove-dir says when the session has added no folders. */
export const NO_FOLDERS_TO_REMOVE = "No added folders to remove.";

interface Props {
  /** The folders this session added with /add-dir (AgentState.additionalRoots). */
  roots: readonly string[];
  onClose: () => void;
  /** Remove this folder from the workspace. */
  onPick: (root: string) => void;
}

/** A folder's own name: "/Users/will/kleio-projects/api" becomes "api". */
function folderName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path;
}

/**
 * /remove-dir: pick one of the folders this session added with /add-dir. Those
 * are the only roots it can remove, so it lists them rather than opening a
 * folder dialog, which also can't see a Kleio host's disk. The rows are
 * HostFoldersModal's, with a remove mark where its chevron sits.
 */
export function RemoveDirModal({ roots, onClose, onPick }: Props): React.ReactElement {
  return (
    <Modal title="Remove from workspace" onClose={onClose} className="host-folders-modal">
      {roots.length === 0 ? (
        <p className="modal-hint">{NO_FOLDERS_TO_REMOVE}</p>
      ) : (
        <div className="host-folders-body">
          <ul className="host-folders-list" aria-label="Added folders">
            {roots.map((root) => (
              <li key={root}>
                <button
                  type="button"
                  className="host-folder"
                  title={root}
                  onClick={() => onPick(root)}
                >
                  <span className="host-folder-icon" aria-hidden="true">
                    <FolderSimpleIcon size={16} weight="fill" />
                  </span>
                  <span className="host-folder-text">
                    <span className="host-folder-name">{folderName(root)}</span>
                    <span className="host-folder-place">{folderPlace(root)}</span>
                  </span>
                  <MinusCircleIcon className="host-folder-chevron" size={16} aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Modal>
  );
}

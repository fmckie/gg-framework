import { useEffect, useId, useState } from "react";
import { CaretRightIcon, FolderSimpleIcon } from "@phosphor-icons/react";
import { Modal } from "./Modal";
import { ListSkeleton } from "./Skeleton";
import { listHostProjectFolders, type HostProjectFolder } from "./agent";
import { shortHost } from "./kleio/host-name";

interface Props {
  /** The Kleio host's name, for the title. */
  host: string;
  onClose: () => void;
  /** Open this folder (it may be hidden from the project list). */
  onPick: (folder: HostProjectFolder) => void;
}

type Load =
  | { state: "loading" }
  | { state: "ready"; folders: HostProjectFolder[] }
  | { state: "error"; message: string };

/** A longer list gets a search field; a short one reads at a glance. */
const SEARCH_AFTER = 8;

/**
 * Where a folder lives, to tell apart folders from different projects folders:
 * its parent, with the home folder shown as "~".
 * "/Users/will/kleio-projects/site" becomes "~/kleio-projects".
 */
export function folderPlace(path: string): string {
  const parent = path.replace(/[\\/]+$/, "").replace(/[\\/][^\\/]*$/, "");
  return parent.replace(/^\/(?:Users|home)\/[^/]+(?=\/|$)/, "~") || "/";
}

/**
 * "Open existing" while paired with a Kleio host: this device can't browse the
 * host's disk, so pick from the folders in the host's projects folders, as a
 * grouped list. Hidden ones get their own group, so hiding never loses a
 * project, and opening one puts it back on the list (ProjectPicker).
 */
export function HostFoldersModal({ host, onClose, onPick }: Props): React.ReactElement {
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [query, setQuery] = useState("");
  const name = shortHost(host);

  useEffect(() => {
    let cancelled = false;
    const run = async (): Promise<void> => {
      try {
        const folders = await listHostProjectFolders();
        if (!cancelled) setLoad({ state: "ready", folders });
      } catch (e: unknown) {
        if (!cancelled) {
          setLoad({ state: "error", message: e instanceof Error ? e.message : String(e) });
        }
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  const retry = (): void => {
    setLoad({ state: "loading" });
    setAttempt((n) => n + 1);
  };

  return (
    <Modal title={`Open from ${name}`} onClose={onClose} className="host-folders-modal">
      {load.state === "error" ? (
        <div className="host-folders-state">
          <p className="modal-error" role="alert">
            {load.message}
          </p>
          <button type="button" className="modal-btn" onClick={retry}>
            Try again
          </button>
        </div>
      ) : load.state === "loading" ? (
        <ListSkeleton rows={4} />
      ) : load.folders.length === 0 ? (
        <p className="modal-hint">No project folders on {name} yet. Use New project to make one.</p>
      ) : (
        <FolderList folders={load.folders} query={query} setQuery={setQuery} onPick={onPick} />
      )}
    </Modal>
  );
}

function FolderList({
  folders,
  query,
  setQuery,
  onPick,
}: {
  folders: HostProjectFolder[];
  query: string;
  setQuery: (query: string) => void;
  onPick: (folder: HostProjectFolder) => void;
}): React.ReactElement {
  const needle = query.trim().toLowerCase();
  const matches = needle ? folders.filter((f) => f.name.toLowerCase().includes(needle)) : folders;
  const listed = matches.filter((f) => !f.hidden);
  const hidden = matches.filter((f) => f.hidden);
  // A second line only where it tells two same-named folders apart.
  const seen = new Set<string>();
  const shared = new Set<string>();
  for (const f of folders) (seen.has(f.name) ? shared : seen).add(f.name);
  const grouped = folders.some((f) => f.hidden) && folders.some((f) => !f.hidden);

  return (
    <>
      {folders.length > SEARCH_AFTER && (
        <input
          className="picker-search host-folders-search"
          type="search"
          placeholder={"Search folders\u2026"}
          aria-label="Search folders"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      )}
      <div className="host-folders-body">
        {matches.length === 0 && (
          <p className="modal-hint">No folders match {`\u201c${query.trim()}\u201d`}.</p>
        )}
        {listed.length > 0 && (
          <FolderGroup
            heading={grouped ? "Projects" : null}
            folders={listed}
            shared={shared}
            onPick={onPick}
          />
        )}
        {hidden.length > 0 && (
          <FolderGroup
            heading="Hidden"
            note="Hidden from your project list. Opening one puts it back."
            folders={hidden}
            shared={shared}
            onPick={onPick}
          />
        )}
      </div>
    </>
  );
}

function FolderGroup({
  heading,
  note,
  folders,
  shared,
  onPick,
}: {
  heading: string | null;
  note?: string;
  folders: HostProjectFolder[];
  /** Names more than one folder has: those rows say where they live. */
  shared: ReadonlySet<string>;
  onPick: (folder: HostProjectFolder) => void;
}): React.ReactElement {
  const headingId = useId();
  const noteId = useId();
  return (
    <div className="host-folders-group">
      {heading && (
        <h3 id={headingId} className="host-folders-heading">
          {heading}
        </h3>
      )}
      <ul
        className="host-folders-list"
        {...(heading ? { "aria-labelledby": headingId } : { "aria-label": "Projects" })}
      >
        {folders.map((f) => (
          <li key={f.path}>
            <button
              type="button"
              className="host-folder"
              title={f.path}
              aria-describedby={note ? noteId : undefined}
              onClick={() => onPick(f)}
            >
              <span className="host-folder-icon" aria-hidden="true">
                <FolderSimpleIcon size={16} weight="fill" />
              </span>
              <span className="host-folder-text">
                <span className="host-folder-name">{f.name}</span>
                {shared.has(f.name) && (
                  <span className="host-folder-place">{folderPlace(f.path)}</span>
                )}
              </span>
              <CaretRightIcon
                className="host-folder-chevron"
                size={14}
                weight="bold"
                aria-hidden="true"
              />
            </button>
          </li>
        ))}
      </ul>
      {note && (
        <p id={noteId} className="host-folders-note">
          {note}
        </p>
      )}
    </div>
  );
}

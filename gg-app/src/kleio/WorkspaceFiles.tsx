// Outputs from a Chat or Code session on the Mac mini, opened from a paired
// device. While Kleio is connected to a remote host, the session's folder
// (`cwd`, a path on the mini) becomes a file owner: replies that link to a
// report, a spreadsheet, an image or a web page get the same cards as a
// Specialist's, and clicking such a link opens it from the mini instead of
// looking for the path on this device. Source files a Code agent mentions
// (`src/App.tsx`) stay plain links.

import { createContext, useCallback, useContext, useMemo } from "react";
import { LinkHandlerProvider } from "../Markdown";
import { toast } from "../toast";
import { FileCards } from "./FileCard";
import {
  fileErrorText,
  isOutputPath,
  isSitePath,
  openFile,
  openSite,
  siteErrorText,
  workspaceFileLinks,
  workspaceFilePath,
  type FileOwner,
} from "./kleioFiles";

type WorkspaceOwner = Extract<FileOwner, { kind: "workspace" }>;

/** The session folder's owner, or null when outputs aren't served remotely. */
const WorkspaceFilesContext = createContext<WorkspaceOwner | null>(null);

/**
 * Makes the transcript's outputs openable from the Mac mini. `cwd` is the
 * session's folder on the host; pass null when not connected to one, which
 * leaves every link and reply exactly as before.
 */
export function WorkspaceFilesProvider({
  cwd,
  children,
}: {
  cwd: string | null | undefined;
  children: React.ReactNode;
}): React.ReactElement {
  const owner = useMemo<WorkspaceOwner | null>(
    () => (cwd ? { kind: "workspace", cwd } : null),
    [cwd],
  );

  const handleLink = useCallback(
    (href: string): boolean => {
      if (!owner) return false;
      const path = workspaceFilePath(href, owner.cwd);
      if (!path || !isOutputPath(path)) return false;
      const site = isSitePath(path);
      (site ? openSite(owner, path) : openFile(owner, path)).catch((e: unknown) => {
        toast(site ? siteErrorText(e) : fileErrorText(e), "error");
      });
      return true;
    },
    [owner],
  );

  return (
    <WorkspaceFilesContext.Provider value={owner}>
      <LinkHandlerProvider value={owner ? handleLink : null}>{children}</LinkHandlerProvider>
    </WorkspaceFilesContext.Provider>
  );
}

/** Cards for the outputs an assistant reply links to, when served remotely.
 *  Reads the reply's full text, not the streamed reveal, so a card appears
 *  once with its link instead of flickering in word by word. */
export function WorkspaceFileCards({ text }: { text: string }): React.ReactElement | null {
  const owner = useContext(WorkspaceFilesContext);
  const links = useMemo(() => (owner ? workspaceFileLinks(text, owner.cwd) : []), [owner, text]);
  if (!owner || links.length === 0) return null;
  return <FileCards owner={owner} links={links} />;
}

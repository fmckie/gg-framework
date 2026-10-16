// Outputs from a Chat or Code session on the Mac mini, opened from a paired
// device. While Kleio is connected to a remote host, the session's folder
// (`cwd`, a path on the mini) becomes a file owner: replies that link to a
// report, a spreadsheet, an image or a web page get the same cards as a
// Specialist's, and clicking such a link opens it from the mini instead of
// looking for the path on this device: in the app's file viewer when Kleio
// draws its kind (viewerContext.ts), which takes notes (`.md`, `.txt`)
// as well, as a site for a web page, else in its app. A picture a tool made
// (generate_image, a screenshot, saved under .gg) opens from the mini the same
// way (`useOpenFromHost`). Source files a Code agent mentions (`src/App.tsx`)
// stay plain links.
//
// Only the path rules load with the app: whether a click is an output is
// decided synchronously. The cards, the viewer and the file actions load on
// first use.

import { createContext, lazy, Suspense, useCallback, useContext, useMemo } from "react";
import { LinkHandlerProvider } from "../Markdown";
import { toast } from "../toast";
import { isOutputPath, isSitePath, isViewablePath, workspaceFilePath } from "./filePaths";
import { useOpenFile } from "./viewerContext";
import type { FileOwner } from "./kleioFiles";

type WorkspaceOwner = Extract<FileOwner, { kind: "workspace" }>;
type OpenFile = ReturnType<typeof useOpenFile>;

const OutputCards = lazy(() =>
  import("./WorkspaceOutputCards").then((m) => ({ default: m.WorkspaceOutputCards })),
);

/** Opens a session's file from the host with `open` (useOpenFile), or says
 *  why it didn't open. The viewer says so itself when it can't show one. */
async function openOutput(open: OpenFile, owner: WorkspaceOwner, path: string): Promise<void> {
  try {
    await open(owner, path);
  } catch (e) {
    const { fileErrorText, siteErrorText } = await import("./kleioFiles");
    toast(isSitePath(path) ? siteErrorText(e) : fileErrorText(e), "error");
  }
}

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

  // A link to an output, or to a file the viewer draws (notes too), opens
  // from the host; any other link (source files) is left to the transcript.
  const open = useOpenFile();
  const handleLink = useCallback(
    (href: string): boolean => {
      if (!owner) return false;
      const path = workspaceFilePath(href, owner.cwd);
      if (!path || !(isOutputPath(path) || isViewablePath(path))) return false;
      void openOutput(open, owner, path);
      return true;
    },
    [owner, open],
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
  if (!owner) return null;
  return (
    <Suspense fallback={null}>
      <OutputCards owner={owner} text={text} />
    </Suspense>
  );
}

/**
 * Opens a picture a tool made (generate_image, a screenshot) from the path it
 * was saved at. While connected to a Kleio host that path is on the host, so
 * the picture opens from there, in the file viewer (or, for a kind it doesn't
 * draw, in its app through the session folder's file route), and is never
 * looked for on this device, where it isn't (the iPhone, or a Mac paired to
 * the mini). Returns false when not connected, so the caller opens it on this
 * device as before.
 */
export function useOpenFromHost(): (path: string) => boolean {
  const owner = useContext(WorkspaceFilesContext);
  const open = useOpenFile();
  return useCallback(
    (path: string): boolean => {
      if (!owner) return false;
      const inFolder = workspaceFilePath(path, owner.cwd);
      if (inFolder) void openOutput(open, owner, inFolder);
      else toast(unservedText(path, owner.cwd), "error");
      return true;
    },
    [owner, open],
  );
}

/**
 * Why the host won't serve this picture: it serves only what is in the
 * session's folder and, of its hidden folders, only the pictures the session's
 * tools saved straight into .gg/generated or .gg/screenshots.
 */
function unservedText(path: string, cwd: string): string {
  const base = cwd.replace(/\/+$/, "");
  const inside = !path.startsWith("/")
    ? path
    : path.startsWith(`${base}/`)
      ? path.slice(base.length + 1)
      : null;
  return inside?.split("/").some((s) => s.startsWith("."))
    ? "Kleio can't open this image here: it's in a hidden folder on your host. Ask for images to be saved in the project folder instead."
    : "Kleio can't open this image here: it isn't in this session's folder on your host.";
}

// Opening the app's file viewer (FileViewer.tsx) from wherever a file shows
// up: a chat's file cards and links, the Assets list, a coding reply's links,
// a picture a tool made, and what Kleio is showing on a call. This part loads
// with the app and only decides, at the click, where a file goes: a web page
// opens as a site, a kind the viewer draws (isViewablePath) opens in the
// viewer, and anything else opens in its own app, as before.
// FileViewerProvider.tsx holds what the viewer has open and loads it on first
// use.

import { createContext, useCallback, useContext, useMemo } from "react";
import { isSitePath, isViewablePath } from "./filePaths";
import { openFile, openSite } from "./fileOpen";
import type { FileOwner } from "./kleioFiles";
import type { Shown } from "./voiceTools";

/** A file the viewer can also open in its own app or save a copy of. */
export interface ViewFile {
  readonly owner: FileOwner;
  readonly path: string;
}

/**
 * What the viewer opens: a file, which it asks the host to show (`label` is
 * the link's text); or a show already up on a call, as it is, at `page`.
 */
export type ViewRequest =
  | {
      readonly kind: "file";
      readonly owner: FileOwner;
      readonly path: string;
      readonly label?: string;
    }
  | {
      readonly kind: "shown";
      readonly shown: Shown;
      readonly page?: number;
      /** Where its file is, when the app can open it in its app or save it. */
      readonly file: ViewFile | null;
    };

export interface ViewerActions {
  /** Opens the viewer on `request`, in place of one already open. */
  readonly view: (request: ViewRequest) => void;
  /** Closes the viewer; given `request`, only while that is what it has open. */
  readonly close: (request?: ViewRequest) => void;
}

export interface FileViewerApi extends ViewerActions {
  /** What the viewer has open, or null. */
  readonly request: ViewRequest | null;
}

// Two contexts (FileViewerProvider.tsx provides them): opening a file
// re-renders only what reads the open request.
export const ActionsContext = createContext<ViewerActions | null>(null);
export const RequestContext = createContext<ViewRequest | null>(null);

/** The viewer, or null outside FileViewerProvider. */
export function useFileViewer(): FileViewerApi | null {
  const actions = useContext(ActionsContext);
  const request = useContext(RequestContext);
  return useMemo(() => (actions ? { ...actions, request } : null), [actions, request]);
}

/**
 * Opens a file a card, a link or a list names: a web page as a site, a kind
 * the viewer draws in the viewer, anything else in its own app. Resolves once
 * it's handed on, and rejects with the Rust or host error for the caller to
 * word (siteErrorText for a site, fileErrorText for the rest). Outside
 * FileViewerProvider every file opens in its own app, as before.
 */
export function useOpenFile(): (owner: FileOwner, path: string, label?: string) => Promise<void> {
  const actions = useContext(ActionsContext);
  return useCallback(
    async (owner: FileOwner, path: string, label?: string): Promise<void> => {
      if (isSitePath(path)) return openSite(owner, path);
      if (actions && isViewablePath(path)) {
        actions.view({ kind: "file", owner, path, label });
        return;
      }
      return openFile(owner, path);
    },
    [actions],
  );
}

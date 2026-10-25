// A file opened in its own app (the default app on the Mac, Quick Look on the
// iPhone) or an agent-written web page in the browser, both through the Rust
// side (kleio/files.rs). These two load with the app, for useOpenFile
// (viewerContext.ts); the rest of the file actions, in kleioFiles.ts (which
// re-exports these), load on first use.

import { Channel, invoke } from "@tauri-apps/api/core";
import type { DownloadProgress, FileOwner } from "./kleioFiles";

/** A file command's arguments, with a channel for the download's progress
 *  when the caller wants it (`on_progress` in kleio/files.rs). */
export function fileArgs(
  owner: FileOwner,
  path: string,
  onProgress?: (progress: DownloadProgress) => void,
): Record<string, unknown> {
  return onProgress
    ? { owner, path, onProgress: new Channel<DownloadProgress>(onProgress) }
    : { owner, path };
}

/** Opens a file in its own app, downloading it first if it isn't here yet. */
export const openFile = async (
  owner: FileOwner,
  path: string,
  onProgress?: (progress: DownloadProgress) => void,
): Promise<void> => invoke<void>("kleio_file_open", fileArgs(owner, path, onProgress));

/** Opens an agent-written web page (`.html`/`.htm`) in the browser. */
export const openSite = (owner: FileOwner, path: string): Promise<void> =>
  invoke<void>("kleio_site_open", { owner, path });

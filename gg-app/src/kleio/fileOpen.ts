// A file opened in its own app (the default app on the Mac, Quick Look on the
// iPhone) or an agent-written web page in the browser, both through the Rust
// side (kleio/files.rs). These two load with the app, for useOpenFile
// (viewerContext.ts); the rest of the file actions, in kleioFiles.ts (which
// re-exports these), load on first use.

import { invoke } from "@tauri-apps/api/core";
import type { FileOwner } from "./kleioFiles";

export const openFile = (owner: FileOwner, path: string): Promise<void> =>
  invoke<void>("kleio_file_open", { owner, path });

/** Opens an agent-written web page (`.html`/`.htm`) in the browser. */
export const openSite = (owner: FileOwner, path: string): Promise<void> =>
  invoke<void>("kleio_site_open", { owner, path });

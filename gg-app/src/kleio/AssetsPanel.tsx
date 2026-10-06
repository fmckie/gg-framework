// The files a conversation's specialists linked, gathered in one sidebar list
// so a report from forty messages back is one tap away. Newest first; a file
// linked twice is listed once, at its latest mention. A row opens the file
// (a web page opens as a site), the same as clicking its link or its card.

import { useState } from "react";
import { GlobeIcon } from "@phosphor-icons/react";
import { KindIcon } from "./FileCard";
import { fileExtension, isSitePath } from "./filePaths";
import {
  fileErrorText,
  fileLinks,
  openFile,
  openSite,
  ownerKey,
  siteErrorText,
  type FileOwner,
} from "./kleioFiles";
import { KleioPanel } from "./KleioChrome";

/** At most this many: the list is for reaching recent work fast, not an archive. */
export const MAX_ASSETS = 40;

export interface Asset {
  readonly owner: FileOwner;
  readonly path: string;
  /** The link's text, or the file name. */
  readonly label: string;
  /** Who shared it, e.g. a specialist's name. */
  readonly by: string;
}

/**
 * Every file the messages link to, newest first, one per owner and path.
 * `owner` returns null for a message whose links don't point at a folder (the
 * user's own messages).
 */
export function collectAssets<M extends { text: string }>(
  messages: readonly M[],
  owner: (m: M) => FileOwner | null,
  by: (m: M) => string,
): Asset[] {
  const seen = new Set<string>();
  const out: Asset[] = [];
  for (let i = messages.length - 1; i >= 0 && out.length < MAX_ASSETS; i--) {
    const m = messages[i];
    const o = m ? owner(m) : null;
    if (!m || !o) continue;
    for (const link of fileLinks(m.text, o)) {
      const key = `${ownerKey(o)}\u0000${link.path}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ owner: o, path: link.path, label: link.label, by: by(m) });
      if (out.length >= MAX_ASSETS) break;
    }
  }
  return out;
}

function fileName(path: string): string {
  return path.split("/").filter(Boolean).pop() ?? path;
}

function AssetRow({
  asset,
  onError,
}: {
  asset: Asset;
  onError: (message: string) => void;
}): React.ReactElement {
  const [opening, setOpening] = useState(false);
  const site = isSitePath(asset.path);
  const name = fileName(asset.path);
  const kind = site ? "Site" : fileExtension(name).toUpperCase() || "File";
  async function open(): Promise<void> {
    setOpening(true);
    try {
      await (site ? openSite(asset.owner, asset.path) : openFile(asset.owner, asset.path));
    } catch (e) {
      onError(site ? siteErrorText(e) : fileErrorText(e));
    } finally {
      setOpening(false);
    }
  }
  return (
    <li>
      <button
        type="button"
        className="kleio-asset"
        onClick={() => void open()}
        disabled={opening}
        title={asset.path}
        aria-label={`Open ${asset.label}, shared by ${asset.by}`}
      >
        <span className="kleio-asset-icon" aria-hidden="true">
          {site ? <GlobeIcon size={18} weight="duotone" /> : <KindIcon name={name} size={18} />}
        </span>
        <span className="kleio-asset-text">
          <span className="kleio-asset-name">{asset.label}</span>
          <span className="kleio-asset-meta">{opening ? "Opening…" : `${kind} · ${asset.by}`}</span>
        </span>
      </button>
    </li>
  );
}

/** The sidebar panel; a short note until a specialist has linked a file. */
export function AssetsPanel({
  assets,
  onError,
}: {
  assets: readonly Asset[];
  onError: (message: string) => void;
}): React.ReactElement {
  if (!assets.length)
    return (
      <KleioPanel title="Assets" description="Files your specialists share will appear here." />
    );
  return (
    <KleioPanel title="Assets" count={assets.length}>
      <ul className="kleio-assets" aria-label="Files shared in this conversation, newest first">
        {assets.map((a) => (
          <AssetRow key={`${ownerKey(a.owner)}\u0000${a.path}`} asset={a} onError={onError} />
        ))}
      </ul>
    </KleioPanel>
  );
}

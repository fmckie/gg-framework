// A file an agent linked in chat, shown as a card under its message: the
// first page as a softly blurred preview (Quick Look on this Mac renders it),
// the file's name, kind and size, and Open / Save. The blur lifts on hover or
// focus; clicking the preview opens the file in its usual app. A card only
// fetches its file once it scrolls into view, so a long history of reports
// doesn't download them all at once.
//
// A web page (.html/.htm) gets a site card instead: one Open site action that
// asks the Mac mini for a short-lived link on its sandboxed preview origin and
// opens it in the browser. The page is never downloaded or rendered here, and
// there's no Save (a site is a folder, not one file).

import { useEffect, useRef, useState } from "react";
import {
  ArrowSquareOutIcon,
  DownloadSimpleIcon,
  FileCsvIcon,
  FileDocIcon,
  FileIcon,
  FileImageIcon,
  FilePdfIcon,
  FilePptIcon,
  FileTextIcon,
  FileXlsIcon,
  GlobeIcon,
  WarningCircleIcon,
} from "@phosphor-icons/react";
import { fileExtension, isSitePath } from "./filePaths";
import {
  fetchFile,
  fileErrorText,
  fileKind,
  formatBytes,
  openFile,
  openSite,
  ownerKey,
  saveFile,
  siteErrorText,
  type FileInfo,
  type FileOwner,
} from "./kleioFiles";

/** True once the element has come near the visible area (and stays true). */
function useSeen(ref: React.RefObject<HTMLElement | null>): boolean {
  const [seen, setSeen] = useState(() => typeof IntersectionObserver === "undefined");
  useEffect(() => {
    const el = ref.current;
    if (seen || !el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) setSeen(true);
      },
      { rootMargin: "200px 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [ref, seen]);
  return seen;
}

export function KindIcon({ name, size }: { name: string; size: number }): React.ReactElement {
  const props = { size, weight: "duotone" as const, "aria-hidden": true };
  switch (fileExtension(name)) {
    case "pdf":
      return <FilePdfIcon {...props} />;
    case "doc":
    case "docx":
      return <FileDocIcon {...props} />;
    case "xls":
    case "xlsx":
      return <FileXlsIcon {...props} />;
    case "csv":
      return <FileCsvIcon {...props} />;
    case "ppt":
    case "pptx":
      return <FilePptIcon {...props} />;
    case "png":
    case "jpg":
    case "jpeg":
    case "gif":
    case "webp":
    case "heic":
      return <FileImageIcon {...props} />;
    case "md":
    case "txt":
    case "json":
      return <FileTextIcon {...props} />;
    default:
      return <FileIcon {...props} />;
  }
}

/** The owner, kept by value (`ownerKey`): a parent's fresh but equal owner
 *  object returns the same one, so it doesn't refetch the file. */
function useStableOwner(owner: FileOwner): FileOwner {
  const [held, setHeld] = useState(owner);
  if (ownerKey(held) !== ownerKey(owner)) {
    setHeld(owner);
    return owner;
  }
  return held;
}

type Load =
  { state: "loading" } | { state: "ready"; info: FileInfo } | { state: "error"; text: string };

interface CardProps {
  owner: FileOwner;
  path: string;
  /** The link's text, e.g. "Download your AI research report — 1 October 2026". */
  label: string;
  /**
   * Named in the reply rather than linked ("`report.pdf`"): shown only once the
   * file is found, never as a missing card (the agent may have meant another folder).
   */
  named?: boolean;
}

export function FileCard(props: CardProps): React.ReactElement {
  return isSitePath(props.path) ? <SiteCard {...props} /> : <DocumentCard {...props} />;
}

/** A web page: opened through the Mac mini's preview origin, never fetched. */
function SiteCard({ owner, path, label }: CardProps): React.ReactElement {
  const name = path.split("/").pop() ?? path;
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const title = label && label !== name ? label : name;

  async function open(): Promise<void> {
    if (busy) return;
    setBusy(true);
    setNote(null);
    try {
      await openSite(owner, path);
    } catch (e) {
      setNote(siteErrorText(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="kleio-file is-site">
      <button
        type="button"
        className="kleio-file-peek"
        aria-label={`Open site ${name}`}
        disabled={busy}
        onClick={() => void open()}
      >
        <span className="kleio-file-glyph">
          <GlobeIcon size={30} weight="duotone" aria-hidden="true" />
        </span>
      </button>
      <div className="kleio-file-body">
        <span className="kleio-file-title" title={title}>
          {title}
        </span>
        {title !== name && (
          <span className="kleio-file-name" title={name}>
            {name}
          </span>
        )}
        <span className="kleio-file-meta">Website · opens in your browser</span>
        <span className="kleio-file-actions">
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            disabled={busy}
            onClick={() => void open()}
          >
            <ArrowSquareOutIcon size={13} weight="bold" aria-hidden="true" />
            {busy ? "Opening…" : "Open site"}
          </button>
        </span>
        {note && (
          <span className="kleio-file-note" role="status">
            {note}
          </span>
        )}
      </div>
    </div>
  );
}

/** Any other file: fetched once in view for its size and first-page preview. */
function DocumentCard({ owner, path, label, named }: CardProps): React.ReactElement | null {
  const name = path.split("/").pop() ?? path;
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const [busy, setBusy] = useState<"open" | "save" | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const seen = useSeen(cardRef);
  const stableOwner = useStableOwner(owner);

  useEffect(() => {
    if (!seen) return;
    let live = true;
    setLoad({ state: "loading" });
    fetchFile(stableOwner, path)
      .then((info) => live && setLoad({ state: "ready", info }))
      .catch((e: unknown) => live && setLoad({ state: "error", text: fileErrorText(e) }));
    return () => {
      live = false;
    };
  }, [seen, stableOwner, path]);

  async function act(kind: "open" | "save"): Promise<void> {
    if (busy) return;
    setBusy(kind);
    setNote(null);
    try {
      if (kind === "open") await openFile(owner, path);
      else if (await saveFile(owner, path)) setNote("Saved.");
    } catch (e) {
      setNote(fileErrorText(e));
    } finally {
      setBusy(null);
    }
  }

  // A file the reply only named, and that isn't there, is no card at all.
  if (named && load.state === "error") return null;
  const info = load.state === "ready" ? load.info : null;
  const thumb = info?.thumbnail ?? null;
  const missing = load.state === "error";
  const title = label && label !== name ? label : name;
  const meta = [fileKind(name), info ? formatBytes(info.size) : null].filter(Boolean).join(" · ");

  return (
    <div ref={cardRef} className={`kleio-file${missing ? " is-missing" : ""}`}>
      <button
        type="button"
        className={`kleio-file-peek${thumb ? " has-thumb" : ""}`}
        aria-label={`Open ${name}`}
        disabled={missing || busy !== null}
        onClick={() => void act("open")}
      >
        {thumb ? (
          <img src={thumb} alt="" className="kleio-file-thumb" draggable={false} />
        ) : (
          <span className={`kleio-file-glyph${load.state === "loading" ? " is-loading" : ""}`}>
            <KindIcon name={name} size={30} />
          </span>
        )}
        {thumb && (
          <span className="kleio-file-peek-hint" aria-hidden="true">
            <ArrowSquareOutIcon size={13} weight="bold" />
            Open
          </span>
        )}
      </button>
      <div className="kleio-file-body">
        <span className="kleio-file-title" title={title}>
          {title}
        </span>
        {/* A card titled with the file's name (one the reply named, not linked) shows it once. */}
        {title !== name && (
          <span className="kleio-file-name" title={name}>
            {name}
          </span>
        )}
        <span className="kleio-file-meta">
          {missing ? (
            <>
              <WarningCircleIcon size={13} weight="bold" aria-hidden="true" />
              {load.text}
            </>
          ) : load.state === "loading" ? (
            "Fetching from your Mac mini…"
          ) : (
            meta
          )}
        </span>
        {!missing && (
          <span className="kleio-file-actions">
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              disabled={busy !== null}
              onClick={() => void act("open")}
            >
              <ArrowSquareOutIcon size={13} weight="bold" aria-hidden="true" />
              {busy === "open" ? "Opening…" : "Open"}
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              disabled={busy !== null}
              onClick={() => void act("save")}
            >
              <DownloadSimpleIcon size={13} weight="bold" aria-hidden="true" />
              {busy === "save" ? "Saving…" : "Save a copy"}
            </button>
          </span>
        )}
        {note && (
          <span className="kleio-file-note" role="status">
            {note}
          </span>
        )}
      </div>
    </div>
  );
}

/** The cards for every agent-folder file a message links to or names. */
export function FileCards({
  owner,
  links,
}: {
  owner: FileOwner;
  links: readonly { path: string; label: string; named?: boolean }[];
}): React.ReactElement | null {
  if (links.length === 0) return null;
  return (
    <div className="kleio-files">
      {links.map((l) => (
        <FileCard
          key={l.path}
          owner={owner}
          path={l.path}
          label={l.label}
          named={l.named === true}
        />
      ))}
    </div>
  );
}

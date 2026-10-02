// A file an agent linked in chat, shown as a card under its message: the
// first page as a softly blurred preview (Quick Look on this Mac renders it),
// the file's name, kind and size, and Open / Save. The blur lifts on hover or
// focus; clicking the preview opens the file in its usual app. A card only
// fetches its file once it scrolls into view, so a long history of reports
// doesn't download them all at once.

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
  WarningCircleIcon,
} from "@phosphor-icons/react";
import {
  fetchFile,
  fileErrorText,
  fileExtension,
  fileKind,
  fileOwner,
  formatBytes,
  openFile,
  saveFile,
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

function KindIcon({ name, size }: { name: string; size: number }): React.ReactElement {
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

type Load =
  { state: "loading" } | { state: "ready"; info: FileInfo } | { state: "error"; text: string };

export function FileCard({
  owner,
  path,
  label,
}: {
  owner: FileOwner;
  path: string;
  /** The link's text, e.g. "Download your AI research report — 1 October 2026". */
  label: string;
}): React.ReactElement {
  const name = path.split("/").pop() ?? path;
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const [busy, setBusy] = useState<"open" | "save" | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const seen = useSeen(cardRef);
  // By value, so a parent's fresh owner object doesn't refetch the file.
  const { blobId } = owner;
  const groupId = owner.kind === "group" ? owner.groupId : undefined;

  useEffect(() => {
    if (!seen) return;
    let live = true;
    setLoad({ state: "loading" });
    fetchFile(fileOwner(blobId, groupId), path)
      .then((info) => live && setLoad({ state: "ready", info }))
      .catch((e: unknown) => live && setLoad({ state: "error", text: fileErrorText(e) }));
    return () => {
      live = false;
    };
  }, [seen, blobId, groupId, path]);

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
        <span className="kleio-file-name" title={name}>
          {name}
        </span>
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

/** The cards for every agent-folder file a message links to. */
export function FileCards({
  owner,
  links,
}: {
  owner: FileOwner;
  links: readonly { path: string; label: string }[];
}): React.ReactElement | null {
  if (links.length === 0) return null;
  return (
    <div className="kleio-files">
      {links.map((l) => (
        <FileCard key={l.path} owner={owner} path={l.path} label={l.label} />
      ))}
    </div>
  );
}

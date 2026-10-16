// The file viewer: a file at full size over the app, drawn as a show is on a
// call (ShowViews.tsx), so nothing in it runs. A file is asked of the host as
// a show by its owner and path (POST /kleio/voice/show, kleio-host show.ts);
// a show already up on a call opens as it is. The header offers Open in app
// (the default app on the Mac, Quick Look on the iPhone) and Save a copy, or
// Open in browser for a web page. Esc, × or a click outside closes it, and Esc
// stops here: it never also closes the panel, the call or a drawer beneath
// (an Esc that dismisses a tooltip only dismisses the tooltip).
// Loaded the first time a file opens (FileViewerProvider.tsx).

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowSquareOutIcon, DownloadSimpleIcon, XIcon } from "@phosphor-icons/react";
import { useDialogFocus } from "../dialog-focus";
import { withViewTransition } from "../view-transition";
import { CsvTable } from "./CsvTable";
import { fileExtension } from "./filePaths";
import { createFileShow, KleioApiError, type FileShowRequest } from "./kleioApi";
import { fileErrorText, openFile, saveFile, type FileOwner } from "./kleioFiles";
import type { RenderTable, ShowKit } from "./ShowViews";
import type { ViewFile, ViewRequest } from "./viewerContext";
import type { ShowProblem, Shown } from "./voiceTools";

const OUTDATED = "Update your host to view files here.";
const OUTDATED_WORKSPACE = "Update your host to view coding-session files here.";

/** A CSV: a table when it's small, else its text (CsvTable.tsx). Other text stays plain. */
const asTable: RenderTable = (text, name) =>
  fileExtension(name) === "csv" ? <CsvTable text={text} name={name} /> : null;

function fileName(path: string): string {
  return path.split("/").pop() || path;
}

/** The show request for a file: a specialist's, a group member's or a session folder's. */
function showRequest(owner: FileOwner, path: string): FileShowRequest {
  switch (owner.kind) {
    case "blob":
      return { source: "specialist", id: owner.blobId, path };
    case "group":
      return { source: "group", id: owner.groupId, member: owner.blobId, path };
    case "workspace":
      return { source: "workspace", cwd: owner.cwd, path };
  }
}

/** A host from before shows, as voiceTools.ts reads one: an admin device hears "not found", any other "forbidden". */
function beforeShows(e: KleioApiError): boolean {
  return (
    (e.status === 404 && e.message === "not found") ||
    (e.status === 403 && e.message === "forbidden")
  );
}

/** Why the host didn't show the file, in plain words. Open in app is still offered. */
function openProblem(e: unknown, owner: FileOwner): ShowProblem {
  const failed = (text: string): ShowProblem => ({ kind: "failed", text });
  if (!(e instanceof KleioApiError)) return failed("Couldn't load this from your host.");
  const workspace = owner.kind === "workspace";
  // A host from before shows, or (for a session's file) from before this viewer.
  if (beforeShows(e) || (workspace && e.status === 400))
    return failed(workspace ? OUTDATED_WORKSPACE : OUTDATED);
  switch (e.status) {
    case 0:
    case 503:
      return failed("Couldn't reach your host just now.");
    case 401:
      return failed("Your host didn't accept this device.");
    case 404:
      return failed("Kleio couldn't find that file on your host.");
    case 501:
      return { kind: "unavailable" };
  }
  return failed(e.detail ?? "Kleio couldn't show that file.");
}

/** The show to draw: one already up as it is, or a file's once the host has readied it (null till then). */
function useShown(request: ViewRequest): Shown | null {
  const [opened, setOpened] = useState<Shown | null>(null);
  useEffect(() => {
    if (request.kind !== "file") return;
    let alive = true;
    const name = fileName(request.path);
    const base = {
      key: 0,
      title: request.label?.trim() || name,
      whose: name,
      url: null,
    };
    createFileShow(showRequest(request.owner, request.path)).then(
      (show) => {
        if (alive) setOpened({ ...base, show, problem: null });
      },
      (e: unknown) => {
        if (alive) setOpened({ ...base, show: null, problem: openProblem(e, request.owner) });
      },
    );
    return () => {
      alive = false;
    };
  }, [request]);
  return request.kind === "shown" ? request.shown : opened;
}

/** The page a show from the call opens at: the one tapped there, else the first. */
function firstPage(request: ViewRequest): number {
  const page = request.kind === "shown" ? request.page : undefined;
  return page !== undefined && Number.isInteger(page) && page > 1 ? page : 1;
}

/**
 * Closes the viewer on Esc, and stops it there: in the capture phase on the
 * document, so the voice screen's dialog (document, bubbling), the narrow
 * sidebar's drawer and the brief (window) never hear it. Only the tooltip
 * layer's listener, on the document since the app started, comes first: an
 * Esc it stops (dismissing a tooltip shown on keyboard focus) leaves the
 * viewer open, as it leaves every modal open.
 */
function useEscape(close: () => void): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== "Escape" || e.isComposing || e.cancelBubble) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      close();
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [close]);
}

/** Open in app and Save a copy, each saying how it went in `onNote`. */
function FileActions({
  file,
  onNote,
}: {
  readonly file: ViewFile;
  readonly onNote: (note: string) => void;
}): React.ReactElement {
  const [busy, setBusy] = useState<"open" | "save" | null>(null);
  async function act(kind: "open" | "save"): Promise<void> {
    if (busy) return;
    setBusy(kind);
    onNote("");
    try {
      if (kind === "open") await openFile(file.owner, file.path);
      else if (await saveFile(file.owner, file.path)) onNote("Saved.");
    } catch (e) {
      onNote(fileErrorText(e));
    } finally {
      setBusy(null);
    }
  }
  return (
    <>
      <button
        type="button"
        className="btn btn-ghost btn-sm file-viewer-action"
        disabled={busy !== null}
        onClick={() => void act("open")}
        title="Open in app"
      >
        <ArrowSquareOutIcon size={16} weight="bold" aria-hidden="true" />
        <span className="file-viewer-action-label">
          {busy === "open" ? "Opening…" : "Open in app"}
        </span>
      </button>
      <button
        type="button"
        className="btn btn-ghost btn-sm file-viewer-action"
        disabled={busy !== null}
        onClick={() => void act("save")}
        title="Save a copy"
      >
        <DownloadSimpleIcon size={16} weight="bold" aria-hidden="true" />
        <span className="file-viewer-action-label">
          {busy === "save" ? "Saving…" : "Save a copy"}
        </span>
      </button>
    </>
  );
}

export function FileViewer({
  request,
  kit,
  onClose,
}: {
  readonly request: ViewRequest;
  /** How it draws the show: the voice panel's views (SHOW_KIT in ShowViews.tsx). */
  readonly kit: ShowKit;
  readonly onClose: () => void;
}): React.ReactElement {
  const { OpenInBrowser, openableLink, pageInView, ShowBody, showHeadline, troubleOf, Waiting } =
    kit;
  const dialogRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const [scroller, setScroller] = useState<HTMLDivElement | null>(null);
  const startPage = firstPage(request);
  const [page, setPage] = useState(startPage);
  const [note, setNote] = useState("");
  const shown = useShown(request);
  const file: ViewFile | null =
    request.kind === "file" ? { owner: request.owner, path: request.path } : request.file;
  // Its own dismissals glide out, as a modal's do (view-transition.ts).
  const dismiss = useCallback(() => withViewTransition(onClose), [onClose]);
  useDialogFocus(dialogRef);
  useEscape(dismiss);

  const opening =
    request.kind === "file" ? request.label?.trim() || fileName(request.path) : request.shown.title;
  const { title, whose } = shown ? showHeadline(shown) : { title: opening, whose: null };
  const trouble = shown ? troubleOf(shown) : null;
  const show = shown && trouble === null ? shown.show : null;
  const link = shown && trouble === null ? openableLink(shown) : null;
  const pdf = show?.kind === "pdf" && show.state === "ready" ? show : null;

  // The body, kept for a PDF's pages to watch. Opened at a page (one tapped on
  // the call), it starts there: the pages are laid out once it's attached.
  const attachBody = useCallback(
    (el: HTMLDivElement | null) => {
      setScroller(el);
      if (!el || startPage < 2) return;
      const slot = el.querySelector<HTMLElement>(`[data-page="${startPage}"]`);
      if (slot) el.scrollTop = Math.max(0, slot.offsetTop - 16);
    },
    [startPage],
  );

  return createPortal(
    <div
      className="file-viewer-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) dismiss();
      }}
    >
      <div
        ref={dialogRef}
        className="file-viewer"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        <header className="voice-show-head file-viewer-head">
          <div className="voice-show-titles">
            <h2 id={titleId} className="voice-show-title" title={title}>
              {title}
            </h2>
            {whose && (
              <p className="voice-show-whose" title={whose}>
                {whose}
              </p>
            )}
          </div>
          {pdf && (
            <span className="voice-show-at">
              Page {page} of {pdf.totalPages ?? pdf.pages}
            </span>
          )}
          {link ? (
            <OpenInBrowser url={link} />
          ) : (
            file && <FileActions file={file} onNote={setNote} />
          )}
          <button
            type="button"
            className="icon-circle voice-show-close"
            aria-label={`Close ${title}`}
            title="Close (Esc)"
            onClick={dismiss}
          >
            <XIcon size={16} weight="bold" aria-hidden="true" />
          </button>
        </header>
        <p className="file-viewer-note" role="status">
          {note}
        </p>
        <div
          ref={attachBody}
          className="voice-show-body file-viewer-body"
          // Focused first, so the arrow keys and Space scroll straight away.
          tabIndex={0}
          data-modal-initial-focus=""
          onScroll={pdf ? (e) => setPage(pageInView(e.currentTarget)) : undefined}
        >
          {shown ? (
            <ShowBody shown={shown} root={scroller} renderTable={asTable} />
          ) : (
            <Waiting text="Opening…" />
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

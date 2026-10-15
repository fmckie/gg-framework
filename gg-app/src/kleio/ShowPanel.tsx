// What Kleio is showing, beside her on the voice screen (VoiceMode.tsx): a
// document's text, a picture, a PDF's pages or a picture of a web page, in a
// glass panel with its title, whose it is and ×. The host readies each show
// (kleio-host show.ts); this side asks only for a show's parts by id
// (getShowPart, through show.rs, which passes on nothing but plain text and
// pictures) and draws pictures from blob: URLs. Nothing in a show runs:
// Markdown has no raw HTML, a web page is a picture of the page, and a link
// opens only as a web page in the browser, through safeExternalUrl.

import { lazy, Suspense, useEffect, useId, useRef, useState } from "react";
import { ArrowSquareOutIcon, WarningCircleIcon, XIcon } from "@phosphor-icons/react";
import { getShowPart, KleioApiError, type ShowInfo, type ShowPart } from "./kleioApi";
import { openExternal, safeExternalUrl } from "./safeUrl";
import type { Shown } from "./voiceTools";

/** Every link in a shown document: a web page opens in the browser, anything else nowhere. */
function openLink(href: string): boolean {
  openExternal(href);
  // Handled either way: never opened as a project path or in another app.
  return true;
}

/**
 * No link in a shown document navigates this window, not even an empty or
 * `#` one that Markdown leaves to the webview: it opens in the browser
 * (openLink) or nowhere.
 */
function stayPut(e: React.MouseEvent): void {
  if (e.target instanceof Element && e.target.closest("a")) e.preventDefault();
}

/** Markdown and its highlighter load with the first document she shows, not with the app. */
const ShowMarkdown = lazy(() =>
  import("../Markdown").then(({ LinkHandlerProvider, Markdown }) => ({
    default: function ShowMarkdown({ text }: { readonly text: string }): React.ReactElement {
      return (
        <LinkHandlerProvider value={openLink}>
          <Markdown>{text}</Markdown>
        </LinkHandlerProvider>
      );
    },
  })),
);

/** The host's words for a host that can't draw pages or PDFs (capture.ts). */
const CANT_DRAW = "Kleio can't show web pages or PDFs on this host.";
const SIGN_IN =
  "This page asks you to sign in or subscribe, so this is what a visitor sees. Open it in your browser to see yours.";
const GONE = "That has expired. Ask Kleio to show it again.";
const CHANGED = "That file has changed since Kleio showed it. Ask her to show it again.";

type Loaded<T> =
  | { readonly state: "loading" }
  | { readonly state: "ready"; readonly value: T }
  | { readonly state: "failed"; readonly text: string };

/** Why a part didn't come, in plain words: the host's own sentence when it sent one. */
function partTrouble(e: unknown): string {
  if (!(e instanceof KleioApiError)) return "Couldn't load this from your host.";
  // Errors on this side (no host, no connection) carry technical details.
  if (e.status === 0) return "Couldn't reach your host just now.";
  if (e.detail) return e.detail;
  if (e.status === 404 || e.status === 410) return GONE;
  if (e.status === 409) return CHANGED;
  return "Couldn't load this from your host.";
}

const startsWith = (b: Uint8Array, at: number, sig: readonly number[]): boolean =>
  b.length >= at + sig.length && sig.every((n, i) => b[at + i] === n);
const ascii = (s: string): number[] => [...s].map((c) => c.charCodeAt(0));

/**
 * The picture type `bytes` start with: PNG, JPEG, GIF or WebP, the only
 * kinds drawn; null for anything else (an SVG could run script). The blob
 * gets this type, never one a host or file claimed.
 */
export function pictureType(bytes: Uint8Array): string | null {
  if (startsWith(bytes, 0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (startsWith(bytes, 0, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (startsWith(bytes, 0, ascii("GIF87a")) || startsWith(bytes, 0, ascii("GIF89a"))) {
    return "image/gif";
  }
  if (startsWith(bytes, 0, ascii("RIFF")) && startsWith(bytes, 8, ascii("WEBP"))) {
    return "image/webp";
  }
  return null;
}

/** A show's text part, decoded as UTF-8. */
function useShowText(id: string): Loaded<string> {
  const [got, setGot] = useState<Loaded<string>>({ state: "loading" });
  useEffect(() => {
    let alive = true;
    setGot({ state: "loading" });
    void getShowPart(id, "text").then(
      (bytes) => {
        if (alive) setGot({ state: "ready", value: new TextDecoder().decode(bytes) });
      },
      (e: unknown) => {
        if (alive) setGot({ state: "failed", text: partTrouble(e) });
      },
    );
    return () => {
      alive = false;
    };
  }, [id]);
  return got;
}

/**
 * A show's picture or page as a blob: URL, once `wanted`; let go when the
 * panel moves on. Bytes that aren't a picture this draws are refused.
 */
function useShowPicture(id: string, part: ShowPart, wanted = true): Loaded<string> {
  const [got, setGot] = useState<Loaded<string>>({ state: "loading" });
  useEffect(() => {
    if (!wanted) return;
    let alive = true;
    let url: string | null = null;
    setGot({ state: "loading" });
    void getShowPart(id, part).then(
      (bytes) => {
        if (!alive) return;
        const type = pictureType(bytes);
        if (!type) {
          setGot({ state: "failed", text: "That isn't a picture Kleio can show." });
          return;
        }
        url = URL.createObjectURL(new Blob([bytes.slice()], { type }));
        setGot({ state: "ready", value: url });
      },
      (e: unknown) => {
        if (alive) setGot({ state: "failed", text: partTrouble(e) });
      },
    );
    return () => {
      alive = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [id, part, wanted]);
  return got;
}

/** True once `ref` comes within a screen of `root`'s visible part (and stays true). */
function useNear(ref: React.RefObject<HTMLElement | null>, root: HTMLElement | null): boolean {
  const [near, setNear] = useState(() => typeof IntersectionObserver === "undefined");
  useEffect(() => {
    const el = ref.current;
    if (near || !el || !root) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) setNear(true);
      },
      { root, rootMargin: "100% 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [ref, root, near]);
  return near;
}

/** The page whose top has passed a third of the way down the scroller: the one being read. */
function pageInView(scroller: HTMLElement): number {
  const mark = scroller.scrollTop + scroller.clientHeight / 3;
  let page = 1;
  for (const slot of scroller.querySelectorAll<HTMLElement>("[data-page]")) {
    if (slot.offsetTop > mark) break;
    page = Number(slot.dataset.page) || page;
  }
  return page;
}

/** A show's title and whose it is, as the panel's header and the screen reader say them. */
export function showHeadline(shown: Shown): { title: string; whose: string | null } {
  // A page or an online PDF goes by its own title once drawn, under its site.
  const own = shown.url ? shown.show?.title : undefined;
  const title = own ?? shown.title;
  return { title, whose: shown.whose && shown.whose !== title ? shown.whose : null };
}

/** The address "Open in browser" opens: a link that wasn't refused as private, or null. */
function openableLink(shown: Shown): string | null {
  if (shown.problem?.kind === "refused" || shown.show?.reason === "refused") return null;
  return safeExternalUrl(shown.url);
}

/** What stands in the show's place when it can't be drawn, or null when it can. */
function troubleOf(shown: Shown): string | null {
  const { problem, show } = shown;
  switch (problem?.kind) {
    case "unavailable":
      return CANT_DRAW;
    case "outdated":
      return shown.url
        ? "Update your host to show web pages and PDFs."
        : "Update your host to show files here.";
    case "refused":
    case "failed":
      return problem.text;
  }
  if (!show) return "Kleio couldn't show that.";
  if (show.state !== "failed") return null;
  return show.detail ?? `${show.host ?? shown.title} couldn't be shown.`;
}

function OpenInBrowser({ url }: { readonly url: string }): React.ReactElement {
  return (
    <button
      type="button"
      className="btn btn-ghost btn-sm voice-show-open"
      onClick={() => openExternal(url)}
      title="Open in browser"
    >
      <ArrowSquareOutIcon size={16} weight="bold" aria-hidden="true" />
      <span className="voice-show-open-label">Open in browser</span>
    </button>
  );
}

function Waiting({ text }: { readonly text: string }): React.ReactElement {
  return (
    <div className="voice-show-state" role="status">
      <span className="voice-show-spin" aria-hidden="true" />
      <p>{text}</p>
    </div>
  );
}

function Trouble({
  text,
  link,
}: {
  readonly text: string;
  readonly link: string | null;
}): React.ReactElement {
  return (
    <div className="voice-show-state is-trouble">
      <WarningCircleIcon size={30} weight="duotone" aria-hidden="true" />
      <p>{text}</p>
      {link && <OpenInBrowser url={link} />}
    </div>
  );
}

/** A document: Markdown drawn, anything else as plain text. */
function TextView({ show }: { readonly show: ShowInfo }): React.ReactElement {
  const text = useShowText(show.id);
  if (text.state === "failed") return <Trouble text={text.text} link={null} />;
  if (text.state === "loading") return <Waiting text="Loading…" />;
  if (!text.value.trim()) return <Trouble text="This file is empty." link={null} />;
  return (
    <div className="voice-show-doc" onClickCapture={stayPut}>
      {show.format === "markdown" ? (
        <Suspense fallback={<Waiting text="Loading…" />}>
          <ShowMarkdown text={text.value} />
        </Suspense>
      ) : (
        <pre className="voice-show-pre">{text.value}</pre>
      )}
      {show.cut && <p className="voice-show-note">Only the start of this file is shown.</p>}
    </div>
  );
}

function PictureView({
  show,
  title,
}: {
  readonly show: ShowInfo;
  readonly title: string;
}): React.ReactElement {
  const pic = useShowPicture(show.id, "image");
  if (pic.state === "failed") return <Trouble text={pic.text} link={null} />;
  if (pic.state === "loading") return <Waiting text="Loading…" />;
  return (
    <div className="voice-show-picture">
      <img src={pic.value} alt={title} draggable={false} />
    </div>
  );
}

/** One page of a PDF, fetched when it comes near. */
function PdfPage({
  id,
  n,
  total,
  root,
}: {
  readonly id: string;
  readonly n: number;
  readonly total: number;
  readonly root: HTMLElement | null;
}): React.ReactElement {
  const slot = useRef<HTMLDivElement>(null);
  const near = useNear(slot, root);
  const pic = useShowPicture(id, `page-${n}`, near);
  const label = `Page ${n} of ${total}`;
  return (
    <div
      ref={slot}
      className={`voice-show-page${pic.state === "ready" ? "" : " is-waiting"}`}
      data-page={n}
    >
      {pic.state === "ready" ? (
        <img src={pic.value} alt={label} draggable={false} />
      ) : pic.state === "failed" ? (
        <p className="voice-show-page-trouble">
          {label}: {pic.text}
        </p>
      ) : (
        <span className="sr-only">{label}</span>
      )}
    </div>
  );
}

function PdfView({
  show,
  root,
}: {
  readonly show: ShowInfo;
  readonly root: HTMLElement | null;
}): React.ReactElement {
  const pages = show.pages ?? 0;
  const total = show.totalPages ?? pages;
  return (
    <div className="voice-show-pages">
      {Array.from({ length: pages }, (_, i) => (
        <PdfPage key={i + 1} id={show.id} n={i + 1} total={total} root={root} />
      ))}
      {total > pages && (
        <p className="voice-show-note">
          Only the first {pages} of its {total} pages are shown.
        </p>
      )}
    </div>
  );
}

/** A picture of a web page, drawn on the host; tapping it opens the page itself. */
function WebView({
  show,
  host,
  link,
}: {
  readonly show: ShowInfo;
  readonly host: string;
  readonly link: string | null;
}): React.ReactElement {
  const pic = useShowPicture(show.id, "image");
  if (pic.state === "failed") return <Trouble text={pic.text} link={link} />;
  if (pic.state === "loading") return <Waiting text={`Loading ${host}…`} />;
  return (
    <div className="voice-show-web">
      {show.signIn && <p className="voice-show-note is-sign-in">{SIGN_IN}</p>}
      {link ? (
        <button
          type="button"
          className="voice-show-shot"
          aria-label={`Open ${host} in your browser`}
          onClick={() => openExternal(link)}
        >
          <img src={pic.value} alt="" draggable={false} />
        </button>
      ) : (
        <img className="voice-show-shot" src={pic.value} alt={`The page at ${host}`} />
      )}
      {show.cut && (
        <p className="voice-show-note">
          The page goes on. Open it in your browser to see the rest.
        </p>
      )}
    </div>
  );
}

export interface ShowPanelProps {
  readonly shown: Shown;
  /** Closed, and gliding out as the room rearranges: still drawn, no longer usable. */
  readonly leaving?: boolean;
  readonly onClose: () => void;
  readonly ref?: React.Ref<HTMLElement>;
}

/**
 * The panel beside her orb. It never takes focus when she opens it (the call
 * goes on); Esc, × or her `hide` close it (VoiceMode.tsx).
 */
export function ShowPanel({
  shown,
  leaving = false,
  onClose,
  ref,
}: ShowPanelProps): React.ReactElement {
  const titleId = useId();
  const [scroller, setScroller] = useState<HTMLDivElement | null>(null);
  const [page, setPage] = useState(1);
  const { title, whose } = showHeadline(shown);
  const link = openableLink(shown);
  const trouble = troubleOf(shown);
  const show = trouble === null ? shown.show : null;
  const host = show?.host ?? shown.whose;
  const pdf = show?.kind === "pdf" && show.state === "ready" ? show : null;

  let body: React.ReactElement;
  if (trouble !== null || !show) body = <Trouble text={trouble ?? GONE} link={link} />;
  else if (show.state === "capturing") body = <Waiting text={`Loading ${host}…`} />;
  else if (show.kind === "text") body = <TextView show={show} />;
  else if (show.kind === "image") body = <PictureView show={show} title={title} />;
  else if (show.kind === "pdf") body = <PdfView show={show} root={scroller} />;
  else body = <WebView show={show} host={host} link={link} />;

  return (
    <section
      ref={ref}
      className="voice-show"
      aria-labelledby={titleId}
      data-kind={show?.kind ?? "trouble"}
      data-leaving={leaving ? "" : undefined}
      inert={leaving}
    >
      <header className="voice-show-head">
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
        {link && trouble === null && <OpenInBrowser url={link} />}
        <button
          type="button"
          className="icon-circle voice-show-close"
          aria-label={`Close ${title}`}
          title="Close (Esc)"
          onClick={onClose}
        >
          <XIcon size={16} weight="bold" aria-hidden="true" />
        </button>
      </header>
      <div
        ref={setScroller}
        className="voice-show-body"
        // WebKit doesn't let the keyboard into a scroller unless it's focusable.
        tabIndex={0}
        onScroll={pdf ? (e) => setPage(pageInView(e.currentTarget)) : undefined}
      >
        {body}
      </div>
    </section>
  );
}

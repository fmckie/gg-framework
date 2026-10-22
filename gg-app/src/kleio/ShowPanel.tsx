// What Kleio is showing, beside her on the voice screen (VoiceMode.tsx), in a
// glass panel with its title, whose it is, Full size and ×. ShowViews.tsx
// draws the show itself: a document's text, a picture, a PDF's pages or a
// picture of a web page, asked of the host by id and never run. Full size, or
// a click on the show, opens it in the file viewer over the call.

import { useId, useState } from "react";
import { XIcon } from "@phosphor-icons/react";
import {
  HeadButton,
  OpenInBrowser,
  openableLink,
  pageInView,
  ShowBody,
  showHeadline,
  troubleOf,
  type Enlarge,
} from "./ShowViews";
import type { Shown } from "./voiceTools";

export { pictureType, showHeadline } from "./ShowViews";

export interface ShowPanelProps {
  readonly shown: Shown;
  /** Closed, and gliding out as the room rearranges: still drawn, no longer usable. */
  readonly leaving?: boolean;
  readonly onClose: () => void;
  /**
   * Opens it full size (the file viewer), at a PDF's page: from Full size in
   * the header, or a click on the show once it's drawn. Without it, it can't be.
   */
  readonly onEnlarge?: Enlarge;
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
  onEnlarge,
  ref,
}: ShowPanelProps): React.ReactElement {
  const titleId = useId();
  const [scroller, setScroller] = useState<HTMLDivElement | null>(null);
  const [page, setPage] = useState(1);
  const { title, whose } = showHeadline(shown);
  const link = openableLink(shown);
  const trouble = troubleOf(shown);
  const show = trouble === null ? shown.show : null;
  const pdf = show?.kind === "pdf" && show.state === "ready" ? show : null;
  // Only once it's drawn: a page still being drawn would stay a wait.
  const enlarge = show?.state === "ready" ? onEnlarge : undefined;

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
        {enlarge && (
          <HeadButton label="Full size" onClick={() => (pdf ? enlarge(page) : enlarge())}>
            {/* Two arrows out to the corners, drawn here (kleio-theme.css): an
                icon's module carries all six of its weights into the app's
                first load. */}
            <svg
              className="voice-show-full"
              width="16"
              height="16"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <path d="M14.5 4.5h5v5M19.5 4.5l-6 6M9.5 19.5h-5v-5M4.5 19.5l6-6" />
            </svg>
          </HeadButton>
        )}
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
        <ShowBody shown={shown} root={scroller} onEnlarge={enlarge} />
      </div>
    </section>
  );
}

// What Kleio is showing, beside her on the voice screen (VoiceMode.tsx), in a
// glass panel with its title, whose it is and ×. ShowViews.tsx draws the show
// itself: a document's text, a picture, a PDF's pages or a picture of a web
// page, asked of the host by id and never run.

import { useId, useState } from "react";
import { XIcon } from "@phosphor-icons/react";
import {
  OpenInBrowser,
  openableLink,
  pageInView,
  ShowBody,
  showHeadline,
  troubleOf,
} from "./ShowViews";
import type { Shown } from "./voiceTools";

export { pictureType, showHeadline } from "./ShowViews";

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
  const pdf = show?.kind === "pdf" && show.state === "ready" ? show : null;

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
        <ShowBody shown={shown} root={scroller} />
      </div>
    </section>
  );
}

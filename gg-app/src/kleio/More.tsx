// A section's longer prose on a desktop Settings page, folded behind a quiet
// native "More". Named for its section, so the page's folds read apart in a
// screen reader's list ("More about Relays").

export function More({
  about,
  children,
}: {
  /** The section's title. */
  about: string;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <details className="st-more">
      <summary className="st-more-summary" aria-label={`More about ${about}`}>
        More
      </summary>
      <div className="st-more-body">{children}</div>
    </details>
  );
}

import { theme } from "./theme";
import { useModalEmbedState } from "./modal-embed";

/**
 * One section of a settings panel, written once for both places the panel
 * shows:
 * - on the full-screen Settings page: a card holding a title, a one-line
 *   description of what the section is for, and the fields;
 * - in a dialog (tray, chat view): the dialog's usual small label, with
 *   `dialogHint` (if any) under it, then the fields, so dialogs look as they
 *   always have.
 * A page's buttons (Save, Add, Start serving) live in the screen's header bar,
 * via `SettingsHeaderAction`, not in sections.
 */
export function SettingsSection({
  title,
  description,
  dialogTitle = title,
  dialogHint,
  children,
}: {
  title: string;
  /** One line on the page: what the section is for. */
  description: React.ReactNode;
  /** The dialog's label, when it differs from the page title; `null` for none. */
  dialogTitle?: string | null;
  /** What the dialog shows under its label (usually a `.modal-hint`), if any. */
  dialogHint?: React.ReactNode;
  children?: React.ReactNode;
}): React.ReactElement {
  const onPage = useModalEmbedState() === "panel";
  if (onPage) {
    return (
      <section className="settings-card" aria-label={title}>
        <div className="settings-section-head">
          <h3 className="settings-section-title">{title}</h3>
          <p className="settings-desc">{description}</p>
        </div>
        {children}
      </section>
    );
  }
  return (
    <>
      {dialogTitle !== null && (
        <div className="modal-label" style={{ color: theme.textMuted }}>
          {dialogTitle}
        </div>
      )}
      {dialogHint}
      {children}
    </>
  );
}

/**
 * A card for page-only content (sections a dialog does not have, like the
 * Remote page's Serving). Always renders as a card.
 */
export function SettingsCard({
  title,
  subtitle,
  badge,
  description,
  children,
}: {
  title: string;
  /** Quieter text beside the title, e.g. the service a step uses ("Composio"). */
  subtitle?: string;
  /** A status at the end of the title row (a `Badge`). */
  badge?: React.ReactNode;
  description: React.ReactNode;
  children?: React.ReactNode;
}): React.ReactElement {
  const heading = <h3 className="settings-section-title">{title}</h3>;
  return (
    <section className="settings-card" aria-label={title}>
      <div className="settings-section-head">
        {subtitle || badge ? (
          <div className="settings-card-title-row">
            <div className="settings-card-titles">
              {heading}
              {subtitle && <span className="settings-card-sub">{subtitle}</span>}
            </div>
            {badge}
          </div>
        ) : (
          heading
        )}
        <p className="settings-desc">{description}</p>
      </div>
      {children}
    </section>
  );
}

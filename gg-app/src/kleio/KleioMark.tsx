// The Kleio mark: the app icon's column-K above a wide-tracked serif name.
// Used on the home screen and the connect screens.
import mark from "./assets/kleio-mark.png";

export function KleioMark({ small = false }: { small?: boolean }): React.ReactElement {
  return (
    <div className={`kleio-mark${small ? " is-small" : ""}`} role="img" aria-label="Kleio">
      <img className="kleio-mark-img" src={mark} alt="" draggable={false} />
      <span className="kleio-wordmark" aria-hidden="true">
        KLEIO
      </span>
    </div>
  );
}

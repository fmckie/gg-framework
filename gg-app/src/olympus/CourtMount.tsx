import { lazy, Suspense, type ComponentType } from "react";
import type { CourtProps } from "./OlympusCourt";

type Props = Omit<CourtProps, "stage">;

// The courtyard is decoration: if its chunk won't load, there is none.
const OlympusCourt = lazy((): Promise<{ default: ComponentType<Props> }> =>
  import("./OlympusCourt").then(
    (m) => ({ default: m.OlympusCourt }),
    () => ({ default: () => null }),
  ),
);

// Where the courtyard goes in a goal's Workers view, over the rows, on the
// desktop and the iPhone alike.
export function CourtMount(props: Props): React.ReactElement {
  return (
    <Suspense fallback={null}>
      <OlympusCourt {...props} />
    </Suspense>
  );
}

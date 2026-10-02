// Same shape as LazyConnectionPage: the Apps page (Composio's catalogue and
// sign-in) stays out of the initial chunk until its Settings tab opens.
import { lazy, Suspense } from "react";

const Content = lazy(() => import("./AppsPage").then((m) => ({ default: m.AppsPage })));

export function AppsPage(): React.ReactElement {
  return (
    <Suspense fallback={null}>
      <Content />
    </Suspense>
  );
}

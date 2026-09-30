// Same shape as LazyRemoteHostModal: the Connection page (its QR encoder,
// Tailscale and device views) stays out of the initial chunk until the tab opens.
import { lazy, Suspense } from "react";

const Content = lazy(() => import("./ConnectionPage").then((m) => ({ default: m.ConnectionPage })));

export function ConnectionPage(): React.ReactElement {
  return (
    <Suspense fallback={null}>
      <Content />
    </Suspense>
  );
}

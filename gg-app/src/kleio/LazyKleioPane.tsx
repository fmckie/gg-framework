// Same shape as LazyRemoteHostModal: the Kleio pane stays out of the
// initial chunk until it's opened (remote mode only).
import { lazy, Suspense, type ComponentProps } from "react";

const Content = lazy(() => import("./KleioPane").then((m) => ({ default: m.KleioPane })));

export function KleioPane(props: ComponentProps<typeof Content>): React.ReactElement {
  return (
    <Suspense fallback={null}>
      <Content {...props} />
    </Suspense>
  );
}

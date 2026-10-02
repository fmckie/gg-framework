// Same shape as LazyRemoteHostModal: Kleio's Agents and Groups screen stays
// out of the initial chunk until it's opened.
import { lazy, Suspense, type ComponentProps } from "react";

const Content = lazy(() => import("./KleioScreen").then((m) => ({ default: m.KleioScreen })));

export function KleioScreen(props: ComponentProps<typeof Content>): React.ReactElement {
  return (
    <Suspense fallback={null}>
      <Content {...props} />
    </Suspense>
  );
}

// Same shape as LazyRemoteHostModal: "New device paired" (NewPairingNotice.tsx)
// stays out of the initial chunk. App.tsx mounts it in every view, but only an
// admin device shows it, so an ordinary device never loads it at all.
import { lazy, Suspense, type ComponentProps } from "react";

const Content = lazy(() =>
  import("./NewPairingNotice").then((m) => ({ default: m.NewPairingNotice })),
);

export function NewPairingNotice(props: ComponentProps<typeof Content>): React.ReactElement | null {
  if (!props.active?.admin) return null;
  return (
    <Suspense fallback={null}>
      <Content {...props} />
    </Suspense>
  );
}

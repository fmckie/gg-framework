// Same shape as LazySettingsModal: the pane (and @tauri-apps/plugin-process
// behind its Restart button) stays out of the initial chunk until ⌘⇧K.
import { lazy, Suspense, type ComponentProps } from "react";

const Content = lazy(() =>
  import("./RemoteHostModal").then((m) => ({ default: m.RemoteHostModal })),
);

export function RemoteHostModal(props: ComponentProps<typeof Content>): React.ReactElement {
  return (
    <Suspense fallback={null}>
      <Content {...props} />
    </Suspense>
  );
}

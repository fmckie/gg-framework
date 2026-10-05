// Same shape as LazyKleioScreen: the Settings screen (its tab bar, sign-in,
// MCP, Steroids and About pages, and the settings form) stays out of the
// initial chunk until it's opened.
import { lazy, Suspense, type ComponentProps } from "react";

const Content = lazy(() => import("./SettingsScreen").then((m) => ({ default: m.SettingsScreen })));

export function SettingsScreen(props: ComponentProps<typeof Content>): React.ReactElement {
  return (
    <Suspense fallback={null}>
      <Content {...props} />
    </Suspense>
  );
}

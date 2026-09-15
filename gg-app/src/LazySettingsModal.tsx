import { lazy, Suspense, type ComponentProps } from "react";

const SettingsContent = lazy(() =>
  import("./SettingsModal").then((m) => ({ default: m.SettingsModal })),
);

/** Shared by home and tray entry points; never load settings before opening them. */
export function SettingsModal(props: ComponentProps<typeof SettingsContent>): React.ReactElement {
  return (
    <Suspense fallback={null}>
      <SettingsContent {...props} />
    </Suspense>
  );
}

import { lazy, Suspense, type ComponentProps } from "react";

const MemoryContent = lazy(() => import("./MemoryModal").then((m) => ({ default: m.MemoryModal })));

/**
 * The Brain window, opened from Kleio Chat's header and Setup's Brain card.
 * Its add/edit form stays out of the initial JavaScript until it first opens.
 */
export function MemoryModal(props: ComponentProps<typeof MemoryContent>): React.ReactElement {
  return (
    <Suspense fallback={null}>
      <MemoryContent {...props} />
    </Suspense>
  );
}

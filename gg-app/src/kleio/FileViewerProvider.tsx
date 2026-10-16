// What the app's file viewer (FileViewer.tsx) has open, around the app
// (main.tsx), which alone imports this: the viewer loads the first time a
// file opens. The hooks that open it, and the click's routing, are in
// viewerContext.ts.

import { lazy, Suspense, useCallback, useMemo, useState } from "react";
import { SHOW_KIT } from "./ShowViews";
import { ActionsContext, RequestContext, type ViewRequest } from "./viewerContext";

const FileViewer = lazy(() => import("./FileViewer").then((m) => ({ default: m.FileViewer })));

export function FileViewerProvider({
  children,
}: {
  readonly children: React.ReactNode;
}): React.ReactElement {
  // `at` keys the viewer, so each request starts afresh, even for the same file.
  const [open, setOpen] = useState<{ readonly request: ViewRequest; readonly at: number } | null>(
    null,
  );
  const view = useCallback(
    (request: ViewRequest) => setOpen((o) => ({ request, at: (o?.at ?? 0) + 1 })),
    [],
  );
  const close = useCallback(
    (request?: ViewRequest) =>
      setOpen((o) => (request === undefined || o?.request === request ? null : o)),
    [],
  );
  // The viewer's own ×, Esc and backdrop close whatever it has open.
  const dismiss = useCallback(() => setOpen(null), []);
  const actions = useMemo(() => ({ view, close }), [view, close]);
  return (
    <ActionsContext.Provider value={actions}>
      <RequestContext.Provider value={open?.request ?? null}>
        {children}
        {open && (
          <Suspense fallback={null}>
            <FileViewer key={open.at} request={open.request} kit={SHOW_KIT} onClose={dismiss} />
          </Suspense>
        )}
      </RequestContext.Provider>
    </ActionsContext.Provider>
  );
}

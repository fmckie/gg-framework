// About, in Settings: which Kleio this is. The maker's page (AboutColophon.tsx),
// with the version read here.

import { useEffect, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { AboutColophon } from "./AboutColophon";

export function AboutPage(): React.ReactElement {
  const [version, setVersion] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    async function load(): Promise<void> {
      try {
        const v = await getVersion();
        if (live) setVersion(v);
      } catch {
        // Outside the desktop app (a browser preview) there's no version to show.
      }
    }
    void load();
    return () => {
      live = false;
    };
  }, []);

  return <AboutColophon version={version} />;
}

// About, in Settings: which Kleio this is. The phone keeps the card below; the
// desktop sets the maker's page (AboutColophon.tsx). Both read the version here.

import { useEffect, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { isPhone } from "../platform";
import { AboutColophon } from "./AboutColophon";
import { KleioMark } from "./KleioMark";

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

  if (!isPhone()) return <AboutColophon version={version} />;

  return (
    <section className="settings-card about-card" aria-label="About Kleio">
      <KleioMark small />
      <p className="about-tagline">Talk to your work: chat, code and specialists in one app.</p>
      {version && <p className="about-version">{`Version ${version}`}</p>}
    </section>
  );
}

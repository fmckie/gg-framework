// About, in Settings: which Kleio this is, and the work it's built on. The
// credit used to sit under the home screen's buttons; it lives here now so the
// home screen stays clean.

import { useEffect, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
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

  return (
    <section className="settings-card about-card" aria-label="About Kleio">
      <KleioMark small />
      <p className="about-tagline">Your private assistant, specialists and coder, in one place.</p>
      {version && <p className="about-version">{`Version ${version}`}</p>}
      <p className="about-credit">Built on GG Coder by Ken Kai</p>
    </section>
  );
}

// Settings → General, on the desktop: the project folder leads, with Save
// beside its field; Permissions and Effects sit under it on a hairline. The
// phone keeps SettingsModal as its page and the tray keeps it as its dialog
// (settingsLayout.tsx); reading the folder, the permission's re-check, Browse
// and Save are repeated here until the iPhone slice.

import { useEffect, useId, useRef, useState } from "react";
import { CheckCircleIcon } from "@phosphor-icons/react";
import { open } from "@tauri-apps/plugin-dialog";
import {
  getPermissionsStatus,
  getSettings,
  openPermissionsSettings,
  saveSettings,
  type PermissionsStatus,
} from "../agent";
import { HomeBackgroundButton } from "../HomeBackgroundButton";
import { SoundButton } from "../SoundButton";
import { toast } from "../toast";

interface Props {
  /** Called with the saved folder, so the screen can say so. */
  onSaved?: (projectsRoot: string) => void;
}

export function GeneralPage({ onSaved }: Props): React.ReactElement {
  const id = useId();
  const [folder, setFolder] = useState("");
  // The folder as last saved. Null until one has been: the app then shows its
  // default, which Home doesn't count as set, so it can be saved as it stands.
  const [saved, setSaved] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [permissions, setPermissions] = useState<PermissionsStatus | null>(null);
  const fieldRef = useRef<HTMLInputElement>(null);
  const grantRef = useRef<HTMLButtonElement>(null);
  const statusRef = useRef<HTMLParagraphElement>(null);
  // Grant had keyboard focus when access was granted: the status line takes it.
  const grantHadFocus = useRef(false);

  useEffect(() => {
    let live = true;
    // Read natively, so it needs no wait for the host.
    void getSettings()
      .then((s) => {
        if (!live || !s) return;
        setFolder(s.projectsRoot);
        setSaved((s.configured ?? Boolean(s.projectsRoot)) ? s.projectsRoot : null);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);

  // Access is granted outside the app (System Settings), so it is read again
  // whenever the window regains focus.
  useEffect(() => {
    let live = true;
    const refresh = (): void =>
      void getPermissionsStatus().then((next) => {
        if (!live) return;
        const grant = grantRef.current;
        if (next.granted && grant && document.activeElement === grant) grantHadFocus.current = true;
        setPermissions(next);
      });
    refresh();
    window.addEventListener("focus", refresh);
    return () => {
      live = false;
      window.removeEventListener("focus", refresh);
    };
  }, []);

  useEffect(() => {
    if (!permissions?.granted || !grantHadFocus.current) return;
    grantHadFocus.current = false;
    statusRef.current?.focus();
  }, [permissions]);

  const trimmed = folder.trim();
  const dirty = trimmed !== "" && (saved === null || trimmed !== saved.trim());

  async function browse(): Promise<void> {
    const picked = await open({ directory: true, multiple: false, title: "Projects folder" });
    if (typeof picked === "string") setFolder(picked);
  }

  async function save(): Promise<void> {
    if (!dirty || busy) return;
    setBusy(true);
    try {
      await saveSettings(trimmed);
      setSaved(trimmed);
      // The field shows what was saved, without any spaces typed around it.
      setFolder(trimmed);
      onSaved?.(trimmed);
      // Save goes off now, so focus would be lost with it.
      fieldRef.current?.focus();
    } catch (e) {
      toast(`Couldn't save: ${e instanceof Error ? e.message : String(e)}`, "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="gn-page">
      <section className="gn-lead" aria-labelledby={`${id}-folder`}>
        <h2 className="st-label" id={`${id}-folder`}>
          Project folder
        </h2>
        <p className="kl-voice-line">Where new projects are created.</p>
        <form
          className="tl-add-row"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <input
            ref={fieldRef}
            className="tl-input"
            value={folder}
            placeholder="/Users/you/gg-projects"
            aria-label="Project folder"
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            onChange={(e) => setFolder(e.target.value)}
          />
          <button type="button" className="modal-btn" onClick={() => void browse()}>
            {"Browse…"}
          </button>
          <button
            type="submit"
            // The page's filled button only while there is something to save.
            className={`modal-btn gn-save${dirty && !busy ? " primary" : ""}`}
            disabled={!dirty}
            // While it saves it keeps focus and ignores presses.
            aria-disabled={busy || undefined}
            title={!dirty && trimmed !== "" ? "No changes to save" : undefined}
          >
            {busy ? "Saving…" : "Save"}
          </button>
        </form>
      </section>

      <div className="kl-quiet-row">
        {permissions?.applicable && (
          <section className="kl-quiet" aria-labelledby={`${id}-permissions`}>
            <h2 className="st-label" id={`${id}-permissions`}>
              Permissions
            </h2>
            <p className="kl-quiet-line">Full Disk Access for Kleio.</p>
            <div className="kl-quiet-body">
              {permissions.granted ? (
                <p className="settings-status is-good" role="status" tabIndex={-1} ref={statusRef}>
                  <CheckCircleIcon size={16} weight="fill" aria-hidden="true" />
                  Full Disk Access is granted.
                </p>
              ) : (
                <>
                  <button
                    ref={grantRef}
                    type="button"
                    // Save takes the fill while there is something to save.
                    className={`modal-btn gn-grant${dirty ? "" : " primary"}`}
                    onClick={() => void openPermissionsSettings()}
                  >
                    Grant Permissions…
                  </button>
                  <p className="kl-quiet-note">
                    System Settings opens: switch Kleio on there, then come back.
                  </p>
                </>
              )}
            </div>
          </section>
        )}
        <section className="kl-quiet" aria-labelledby={`${id}-effects`}>
          <h2 className="st-label" id={`${id}-effects`}>
            Effects
          </h2>
          <p className="kl-quiet-line">Sounds, and the home screen&apos;s moving background.</p>
          <div className="kl-quiet-body">
            <div className="modal-row">
              <SoundButton variant="settings" />
              <HomeBackgroundButton />
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

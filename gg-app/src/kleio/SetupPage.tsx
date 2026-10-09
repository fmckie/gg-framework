// Settings → Setup: the short checklist a new device opens on once after
// pairing (see shouldOpenSetup in app-entry-view.ts). Each card says what it's
// for, whether it's done, and offers one thing to do. Keys live on the host;
// only an admin device can change them.

import { useCallback, useEffect, useState } from "react";
import { Badge } from "../Badge";
import { SettingsCard } from "../settings-section";
import { theme } from "../theme";
import { authStatusWithError, type AuthStatusResult } from "../agent";
import { localStorageOrNull, markSetupSeen } from "../app-entry-view";
import type { SettingsTabId } from "../SettingsScreen";
import {
  errorText,
  KleioApiError,
  removeSetupKey,
  getSetupStatus,
  type KeyState,
  type SetupKeyName,
  type SetupStatus,
} from "./kleioApi";
import { GetKeyButton, KeyForm, setupKeyError } from "./KeyForm";
import { VoiceCard } from "./VoiceCard";

type Mark = "done" | "needed" | "optional" | "env";

const MARK_TEXT: Record<Mark, string> = {
  done: "Done",
  needed: "Needed",
  optional: "Optional",
  env: "Set on the host",
};

function StateBadge({ mark }: { mark: Mark }): React.ReactElement {
  const color =
    mark === "done" || mark === "env"
      ? theme.success
      : mark === "needed"
        ? theme.warning
        : undefined;
  return <Badge color={color}>{MARK_TEXT[mark]}</Badge>;
}

const OLDER_HOST = "Your host needs the latest Kleio first.";

type Load = { kind: "loading" } | { kind: "old" } | { kind: "error"; text: string } | SetupLoaded;
interface SetupLoaded {
  kind: "ready";
  status: SetupStatus;
}

function KeyCard({
  name,
  title,
  description,
  hint,
  required,
  load,
  onStatus,
}: {
  name: SetupKeyName;
  title: string;
  description: string;
  hint: string;
  required: boolean;
  load: Load;
  onStatus: (s: SetupStatus) => void;
}): React.ReactElement {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const state: KeyState | null = load.kind === "ready" ? load.status.keys[name] : null;
  const admin = load.kind === "ready" && load.status.admin;
  const mark: Mark =
    state === "saved" ? "done" : state === "env" ? "env" : required ? "needed" : "optional";

  async function remove(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      onStatus(await removeSetupKey(name));
    } catch (e) {
      setError(setupKeyError(name, e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <SettingsCard title={title} description={description}>
      {load.kind === "loading" ? (
        <p className="settings-desc">Checking…</p>
      ) : load.kind === "old" ? (
        <p className="settings-desc">{OLDER_HOST}</p>
      ) : load.kind === "error" ? null : (
        <>
          <div className="modal-row">
            <StateBadge mark={mark} />
          </div>
          {state === "env" ? (
            <p className="settings-desc">
              This key is set on the host itself, so it can't be changed here.
            </p>
          ) : !admin ? null : state === "saved" ? (
            <div className="modal-row">
              <button
                type="button"
                className="btn btn-ghost"
                disabled={busy}
                onClick={() => void remove()}
              >
                {busy ? "Removing…" : "Remove key"}
              </button>
            </div>
          ) : (
            <>
              <KeyForm name={name} onSaved={onStatus} />
              <div className="modal-row">
                <GetKeyButton name={name} />
              </div>
              <p className="settings-desc">{hint}</p>
            </>
          )}
          {error && (
            <p className="settings-desc is-error" role="alert">
              {error}
            </p>
          )}
        </>
      )}
    </SettingsCard>
  );
}

export function SetupPage({
  onOpenTab,
}: {
  onOpenTab: (tab: SettingsTabId) => void;
}): React.ReactElement {
  const [load, setLoad] = useState<Load>({ kind: "loading" });
  const [auth, setAuth] = useState<AuthStatusResult | null>(null);

  // Seeing Setup, however it was reached, means it needn't open by itself again.
  useEffect(() => markSetupSeen(localStorageOrNull()), []);

  const fetchSetup = useCallback(async (): Promise<void> => {
    try {
      const status = await getSetupStatus();
      setLoad({ kind: "ready", status });
    } catch (e) {
      if (e instanceof KleioApiError && e.status === 404) setLoad({ kind: "old" });
      else setLoad({ kind: "error", text: errorText(e) });
    }
  }, []);

  useEffect(() => {
    let live = true;
    void fetchSetup();
    void authStatusWithError().then((a) => live && setAuth(a));
    return () => {
      live = false;
    };
  }, [fetchSetup]);

  const onStatus = (status: SetupStatus): void => setLoad({ kind: "ready", status });
  const signedIn = auth?.providers.filter((p) => p.connected) ?? [];

  return (
    <>
      <p className="kleio-page-intro">
        A few things to set up so Kleio can do everything. You can come back here any time.
      </p>

      {load.kind === "error" && (
        <div className="kleio-error" role="alert">
          <span>{load.text}</span>
          <button
            type="button"
            className="btn btn-sm"
            onClick={() => {
              setLoad({ kind: "loading" });
              void fetchSetup();
            }}
          >
            Try again
          </button>
        </div>
      )}
      {load.kind === "ready" && !load.status.admin && (
        <p className="settings-desc">Finish this on your admin device.</p>
      )}

      <SettingsCard title="Host" description="The always-on computer Kleio runs on.">
        <div className="modal-row">
          <StateBadge mark="done" />
          <span className="settings-desc">Connected to your host.</span>
        </div>
        <div className="modal-row">
          <button type="button" className="btn btn-ghost" onClick={() => onOpenTab("connection")}>
            Connection
          </button>
        </div>
      </SettingsCard>

      <SettingsCard
        title="AI provider"
        description="The AI models Kleio and your specialists think with."
      >
        {auth === null ? (
          <p className="settings-desc">Checking…</p>
        ) : (
          <>
            <div className="modal-row">
              <StateBadge mark={signedIn.length > 0 ? "done" : "needed"} />
              {signedIn.length > 0 && (
                <span className="settings-desc">
                  {`Signed in to ${signedIn.map((p) => p.label).join(", ")}.`}
                </span>
              )}
            </div>
            {auth.error && signedIn.length === 0 && (
              <p className="settings-desc is-error">{auth.error}</p>
            )}
            <div className="modal-row">
              <button
                type="button"
                className={signedIn.length > 0 ? "btn btn-ghost" : "btn btn-primary"}
                onClick={() => onOpenTab("providers")}
              >
                {signedIn.length > 0 ? "AI Providers" : "Sign in"}
              </button>
            </div>
          </>
        )}
      </SettingsCard>

      {/* Until the host says otherwise (an older host can't), assume an admin:
          the host still refuses a change from any other device. */}
      <VoiceCard canEdit={load.kind !== "ready" || load.status.admin} />

      <KeyCard
        name="composio"
        title="Apps (Composio)"
        description="Lets Kleio and your specialists use Gmail, Calendar, Notion and hundreds more."
        hint="In Composio, open Settings, then API Keys, and create a key."
        required
        load={load}
        onStatus={onStatus}
      />

      <KeyCard
        name="typesafe"
        title="Group chats (Typesafe Jev)"
        description="Decides who answers in a group chat. Without it, group chats still work, with simpler rules."
        hint="Typesafe is in early access, so new accounts may have to wait."
        required={false}
        load={load}
        onStatus={onStatus}
      />
    </>
  );
}

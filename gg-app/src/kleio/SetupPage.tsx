// Settings → Setup: the checklist a new device opens on once after pairing
// (see shouldOpenSetup in app-entry-view.ts). At the top, how much is done;
// then one card per step, with its status in the header and one thing to do.
// The optional steps sit apart, under their own label. Keys live on the host;
// only an admin device can change them.

import { useCallback, useEffect, useId, useState } from "react";
import { LockSimpleIcon, WarningCircleIcon } from "@phosphor-icons/react";
import { SettingsCard } from "../settings-section";
import { authStatusWithError, type AuthStatusResult } from "../agent";
import { localStorageOrNull, markSetupSeen } from "../app-entry-view";
import type { SettingsTabId } from "../SettingsScreen";
import { shortHost } from "./host-name";
import { useHostReach, type HostReach } from "./hostReach";
import {
  errorText,
  KleioApiError,
  removeSetupKey,
  getSetupStatus,
  type SetupKeyName,
  type SetupStatus,
} from "./kleioApi";
import { DictationCard } from "./DictationCard";
import { KeyForm, setupKeyError } from "./KeyForm";
import { StepBadge, type StepMark } from "./StepBadge";
import { useKleioRemote } from "./useKleioRemote";
import { VoiceCard } from "./VoiceCard";

type Load = { kind: "loading" } | { kind: "old" } | { kind: "error"; text: string } | SetupLoaded;
interface SetupLoaded {
  kind: "ready";
  status: SetupStatus;
}

/** How many of the needed steps are done, as words and a bar of one segment each. */
function Progress({ done, total }: { done: number; total: number }): React.ReactElement {
  const id = useId();
  const all = done === total;
  return (
    <div className="setup-progress">
      <p className="setup-progress-count" id={`${id}-count`}>
        {all ? `All ${total} done` : `${done} of ${total} done`}
      </p>
      <div
        className="setup-progress-bar"
        role="progressbar"
        aria-labelledby={`${id}-count`}
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={done}
      >
        {Array.from({ length: total }, (_, i) => (
          <span key={i} className={i < done ? "is-done" : undefined} />
        ))}
      </div>
      <p className="settings-desc">You can come back here any time.</p>
    </div>
  );
}

/** A note about the whole page, not a step: outlined, with an icon. */
function Callout({
  tone,
  title,
  children,
}: {
  tone: "info" | "warn";
  title: string;
  children: React.ReactNode;
}): React.ReactElement {
  const Icon = tone === "warn" ? WarningCircleIcon : LockSimpleIcon;
  return (
    <div className={`setup-callout${tone === "warn" ? " is-warn" : ""}`} role="note">
      <span className="setup-callout-icon">
        <Icon size={18} weight="bold" aria-hidden="true" />
      </span>
      <div>
        <p className="setup-callout-title">{title}</p>
        <p className="settings-desc">{children}</p>
      </div>
    </div>
  );
}

function HostCard({
  reach,
  name,
  onOpenTab,
}: {
  reach: HostReach;
  name: string;
  onOpenTab: (tab: SettingsTabId) => void;
}): React.ReactElement {
  const mark: StepMark =
    reach === "connected" ? "done" : reach === "checking" ? "checking" : "unreachable";
  const line =
    reach === "connected"
      ? `Connected to ${name}.`
      : reach === "checking"
        ? `Checking ${name}…`
        : `Can't reach ${name} right now.`;
  return (
    <SettingsCard
      title="Host"
      badge={<StepBadge mark={mark} />}
      description="The always-on computer Kleio runs on."
    >
      <div className="setup-status">
        <p className="settings-desc">{line}</p>
        <button
          type="button"
          className={reach === "disconnected" ? "btn btn-primary" : "btn btn-ghost"}
          onClick={() => onOpenTab("connection")}
        >
          Connection
        </button>
      </div>
    </SettingsCard>
  );
}

function ProviderCard({
  auth,
  onOpenTab,
}: {
  auth: AuthStatusResult | null;
  onOpenTab: (tab: SettingsTabId) => void;
}): React.ReactElement {
  const signedIn = auth?.providers.filter((p) => p.connected) ?? [];
  const mark: StepMark = auth === null ? "checking" : signedIn.length > 0 ? "done" : "needed";
  return (
    <SettingsCard
      title="AI provider"
      badge={<StepBadge mark={mark} />}
      description="The models Kleio and your specialists think with."
    >
      {auth === null ? null : signedIn.length > 0 ? (
        <div className="setup-status">
          <p className="settings-desc">{`Signed in to ${signedIn.map((p) => p.label).join(", ")}.`}</p>
          <button type="button" className="btn btn-ghost" onClick={() => onOpenTab("providers")}>
            AI Providers
          </button>
        </div>
      ) : (
        <>
          {auth.error && <p className="settings-desc is-error">{auth.error}</p>}
          <div className="modal-row">
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => onOpenTab("providers")}
            >
              Sign in
            </button>
          </div>
        </>
      )}
    </SettingsCard>
  );
}

function KeyCard({
  name,
  title,
  subtitle,
  description,
  required,
  load,
  onStatus,
}: {
  name: SetupKeyName;
  title: string;
  subtitle: string;
  description: string;
  required: boolean;
  load: Load;
  onStatus: (s: SetupStatus) => void;
}): React.ReactElement {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const state = load.kind === "ready" ? load.status.keys[name] : null;
  const admin = load.kind === "ready" && load.status.admin;
  const mark: StepMark =
    load.kind === "loading"
      ? "checking"
      : state === null
        ? "unknown"
        : state === "saved"
          ? "done"
          : state === "env"
            ? "env"
            : required
              ? "needed"
              : "optional";

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
    <SettingsCard
      title={title}
      subtitle={subtitle}
      badge={<StepBadge mark={mark} />}
      description={description}
    >
      {state === "env" ? (
        <p className="settings-desc">Set on the host itself, so it can't be changed here.</p>
      ) : state === "saved" && admin ? (
        <div className="setup-status">
          <p className="settings-desc">Saved on your host.</p>
          <button
            type="button"
            className="btn btn-ghost"
            disabled={busy}
            onClick={() => void remove()}
          >
            {busy ? "Removing…" : "Remove key"}
          </button>
        </div>
      ) : state === "missing" && admin ? (
        <KeyForm name={name} onSaved={onStatus} />
      ) : null}
      {error && (
        <p className="settings-desc is-error" role="alert">
          {error}
        </p>
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
  // From the voice card, which asks the host itself: null until it knows.
  const [voiceReady, setVoiceReady] = useState<boolean | null>(null);
  const reach = useHostReach();
  const host = useKleioRemote().status?.active?.host;

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
  const apps = load.kind === "ready" ? load.status.keys.composio : null;
  // The needed steps; Group chats and Dictation are optional and don't count.
  const steps = [
    reach === "connected",
    Boolean(auth?.providers.some((p) => p.connected)),
    voiceReady === true,
    apps === "saved" || apps === "env",
  ];

  return (
    <div className="setup-page">
      <Progress done={steps.filter(Boolean).length} total={steps.length} />

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
        <Callout tone="info" title="Finish setup on your admin device">
          This device shows what's done. Only your admin device can add or change keys.
        </Callout>
      )}
      {load.kind === "old" && (
        <Callout tone="warn" title="Update Kleio on your host">
          Your host runs an older Kleio, so Setup can't check or change the Composio and Typesafe
          keys yet.
        </Callout>
      )}

      <HostCard reach={reach} name={host ? shortHost(host) : "your host"} onOpenTab={onOpenTab} />
      <ProviderCard auth={auth} onOpenTab={onOpenTab} />
      {/* Until the host says otherwise (an older host can't), assume an admin:
          the host still refuses a change from any other device. */}
      <VoiceCard canEdit={load.kind !== "ready" || load.status.admin} onReady={setVoiceReady} />
      <KeyCard
        name="composio"
        title="Apps"
        subtitle="Composio"
        description="Lets Kleio and your specialists use Gmail, Calendar, Notion and hundreds more."
        required
        load={load}
        onStatus={onStatus}
      />

      <h2 className="setup-group-label">Optional</h2>
      <KeyCard
        name="typesafe"
        title="Group chats"
        subtitle="Typesafe"
        description="Decides who answers in a group chat. Without it, group chats still work, with simpler rules."
        required={false}
        load={load}
        onStatus={onStatus}
      />
      {/* Any paired device: dictating starts the same download, and no key is involved. */}
      <DictationCard />
    </div>
  );
}

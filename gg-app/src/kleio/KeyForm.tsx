// A provider key form for the host's setup routes (Setup and Apps pages): a
// password field and Save, which shows "Checking…" while the host tries the key
// with the provider. Errors come back in plain words.

import { useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { ArrowSquareOutIcon } from "@phosphor-icons/react";
import {
  errorText,
  KleioApiError,
  setSetupKey,
  type SetupKeyName,
  type SetupStatus,
} from "./kleioApi";

export const KEY_PROVIDERS: Record<SetupKeyName, { name: string; url: string }> = {
  composio: { name: "Composio", url: "https://dashboard.composio.dev" },
  typesafe: { name: "Typesafe", url: "https://console.typesafe.ai" },
};

/** What went wrong saving or removing a key, in words. */
export function setupKeyError(name: SetupKeyName, e: unknown): string {
  const provider = KEY_PROVIDERS[name].name;
  if (e instanceof KleioApiError) {
    if (e.status === 404) return "Your host needs the latest Kleio first.";
    switch (e.message) {
      case "bad_key":
        return `${provider} didn't accept that key. Check you copied all of it.`;
      case "forbidden":
        return "Only an admin device can change keys.";
      case "set_by_env":
        return "This key is set on the host itself, so it can't be changed here.";
      case "unreachable":
        return `Couldn't reach ${provider} to check the key. Try again.`;
      case "rejected":
        return e.detail
          ? `${provider} couldn't check the key: ${e.detail}`
          : `${provider} couldn't check the key.`;
      case "too_large":
        return "That's too long to be a key. Check what you pasted.";
      case "bad_request":
        return "That doesn't look like a key. Check what you pasted.";
    }
  }
  return errorText(e);
}

export function GetKeyButton({ name }: { name: SetupKeyName }): React.ReactElement {
  return (
    <button
      type="button"
      className="btn btn-ghost"
      onClick={() => void openUrl(KEY_PROVIDERS[name].url)}
    >
      <ArrowSquareOutIcon size={16} weight="bold" aria-hidden="true" />
      Get a key
    </button>
  );
}

export function KeyForm({
  name,
  onSaved,
}: {
  name: SetupKeyName;
  onSaved: (status: SetupStatus) => void;
}): React.ReactElement {
  const provider = KEY_PROVIDERS[name].name;
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const s = await setSetupKey(name, key.trim());
      setKey("");
      onSaved(s);
    } catch (e) {
      setError(setupKeyError(name, e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <form
        className="modal-row"
        onSubmit={(e) => {
          e.preventDefault();
          if (key.trim() && !busy) void save();
        }}
      >
        <input
          className="modal-input"
          type="password"
          autoComplete="off"
          spellCheck={false}
          placeholder={`${provider} API key`}
          aria-label={`${provider} API key`}
          value={key}
          disabled={busy}
          onChange={(e) => setKey(e.target.value)}
        />
        <button type="submit" className="btn btn-primary" disabled={busy || !key.trim()}>
          {busy ? "Checking…" : "Save"}
        </button>
      </form>
      {error && (
        <p className="settings-desc is-error" role="alert">
          {error}
        </p>
      )}
    </>
  );
}

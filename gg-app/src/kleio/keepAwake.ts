// Native keep-awake for Kleio voice conversations. Wraps the Rust
// `keep_awake_acquire` / `keep_awake_release` commands (macOS IOKit user-idle
// assertions; a no-op elsewhere). Never throws into the caller.
import { invoke } from "@tauri-apps/api/core";

export interface AwakeHold {
  /** Release this hold. Safe to call any number of times. */
  release(): void;
}

function makeHoldId(): string {
  const raw =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  const id = raw.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 64);
  return id.length > 0 ? id : `hold-${Date.now().toString(36)}`;
}

/** Keep the display and system awake until `release()` is called. */
export function holdAwake(): AwakeHold {
  const hold = makeHoldId();
  let released = false;
  // Release is sequenced after acquire settles, so an early release() can't
  // race ahead of the acquire and leave the hold leaked.
  const acquired: Promise<void> = invoke<void>("keep_awake_acquire", {
    hold,
  }).catch((e: unknown) => {
    console.warn("keepAwake: acquire failed", e);
  });
  return {
    release(): void {
      if (released) return;
      released = true;
      void acquired
        .then(() => invoke<void>("keep_awake_release", { hold }))
        .catch((e: unknown) => {
          console.warn("keepAwake: release failed", e);
        });
    },
  };
}

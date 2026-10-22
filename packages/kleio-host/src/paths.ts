// On-disk layout for the host. Everything lives under one state directory so
// uninstall is one rm and permissions are one chmod.
//
//   $KLEIO_HOST_HOME, else the OS default (resolveHostHome):
//     macOS    ~/Library/Application Support/Kleio/host
//     Windows  %LOCALAPPDATA%\Kleio\host
//     Linux    $XDG_STATE_HOME/kleio/host (default ~/.local/state/kleio/host)
//   ├── secure/                    0700
//   │   ├── headless-master.key    0600, 32 random bytes
//   │   ├── control-root.key       0600, macaroon root
//   │   ├── admin.token            0600, from `init`
//   │   └── device-registry.json   0600
//   ├── composio.key, typesafe.key, openai.key
//   │                              0600 API keys set from Settings
//   ├── rings/                     per-session SSE replay files
//   ├── sidecar.json               0600, { port, token, pid } from the supervisor
//   ├── work/                      default cwd for the sidecar
//   └── logs/
import { homedir } from "node:os";
import { join, posix, win32 } from "node:path";

export interface HostPaths {
  readonly home: string;
  readonly secureDir: string;
  readonly masterKey: string;
  readonly controlRootKey: string;
  readonly adminToken: string;
  readonly registry: string;
  /** API key files an admin device sets from Settings (host.ts names them the same). */
  readonly composioKey: string;
  readonly typesafeKey: string;
  readonly openaiKey: string;
  readonly rings: string;
  readonly sidecarEndpoint: string;
  readonly work: string;
  readonly logs: string;
}

export interface HostHomeInput {
  readonly platform: string;
  readonly env: Readonly<Record<string, string | undefined>>;
  /** The user's home folder (os.homedir()). */
  readonly homedir: string;
}

/**
 * The state folder: `KLEIO_HOST_HOME` when set, else the OS's own place for
 * per-user app state. A relative `LOCALAPPDATA` or `XDG_STATE_HOME` is ignored
 * (the XDG spec says so). Joins use the target OS's path rules, so the answer
 * is the same on every machine that computes it.
 */
export function resolveHostHome({ platform, env, homedir: home }: HostHomeInput): string {
  const override = env.KLEIO_HOST_HOME;
  if (override !== undefined) return override;
  if (platform === "darwin") {
    return posix.join(home, "Library", "Application Support", "Kleio", "host");
  }
  if (platform === "win32") {
    const local = env.LOCALAPPDATA;
    const base = local && win32.isAbsolute(local) ? local : win32.join(home, "AppData", "Local");
    return win32.join(base, "Kleio", "host");
  }
  const state = env.XDG_STATE_HOME;
  const base = state && posix.isAbsolute(state) ? state : posix.join(home, ".local", "state");
  return posix.join(base, "kleio", "host");
}

export function hostPaths(
  home = resolveHostHome({ platform: process.platform, env: process.env, homedir: homedir() }),
): HostPaths {
  const secureDir = join(home, "secure");
  return {
    home,
    secureDir,
    masterKey: join(secureDir, "headless-master.key"),
    controlRootKey: join(secureDir, "control-root.key"),
    adminToken: join(secureDir, "admin.token"),
    registry: join(secureDir, "device-registry.json"),
    composioKey: join(home, "composio.key"),
    typesafeKey: join(home, "typesafe.key"),
    openaiKey: join(home, "openai.key"),
    rings: join(home, "rings"),
    sidecarEndpoint: join(home, "sidecar.json"),
    work: join(home, "work"),
    logs: join(home, "logs"),
  };
}

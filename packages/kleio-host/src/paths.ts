// On-disk layout for the host. Everything lives under one state directory so
// uninstall is one rm and permissions are set in one place.
//
//   $KLEIO_HOST_HOME, else the OS default (resolveHostHome):
//     macOS    ~/Library/Application Support/Kleio/host
//     Windows  %LOCALAPPDATA%\Kleio\host
//     Linux    $XDG_STATE_HOME/kleio/host (default ~/.local/state/kleio/host)
//   ├── secure/                    0700; locked on Windows
//   │   ├── headless-master.key    0600, 32 random bytes; locked on Windows
//   │   ├── control-root.key       0600, macaroon root; locked on Windows
//   │   ├── link.key               0600, the link's secret key (link-secrets.ts); locked on Windows
//   │   ├── link-pair.key          0600, the link's pairing key (link-secrets.ts); locked on Windows
//   │   ├── link-upstream.token    0600, kleio-link-host's secret for the link listener; locked on Windows
//   │   ├── link-allow.json        0600, the paired devices' link keys; locked on Windows
//   │   ├── admin.token            0600, from `init`; locked on Windows
//   │   └── device-registry.json   0600; locked on Windows
//   ├── node-id                    this host's node ID, settled once (node-id.ts)
//   ├── link/                      the relay list (config.json) and kleio-link-host's state.json (link.ts)
//   ├── composio.key, typesafe.key, openai.key
//   │                              0600 API keys set from Settings; locked on Windows
//   ├── rings/                     per-session SSE replay files
//   ├── sidecar.json               0600, { port, token, pid } from the supervisor; locked on Windows
//   ├── work/                      default cwd for the sidecar
//   └── logs/
//
// POSIX modes do nothing on Windows, so there "locked" means an ACL that
// leaves only the current user any access (acl.ts, secure-dir.ts).
import { homedir } from "node:os";
import { join, posix, win32 } from "node:path";

export interface HostPaths {
  readonly home: string;
  readonly secureDir: string;
  readonly masterKey: string;
  readonly controlRootKey: string;
  readonly adminToken: string;
  readonly registry: string;
  /** The link's secret key (link-secrets.ts). */
  readonly linkKey: string;
  /** The secret key a QR code's ticket pairs with (link-secrets.ts). */
  readonly linkPairKey: string;
  /** The secret kleio-link-host shows on the link listener (link-secrets.ts). */
  readonly linkUpstreamToken: string;
  /** The link's allow-list: each paired device's link key. */
  readonly linkAllow: string;
  /** This host's node ID, settled once (node-id.ts). */
  readonly nodeId: string;
  /** The link's files (link.ts): the relay list, config.json, and kleio-link-host's state.json. */
  readonly linkDir: string;
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
    linkKey: join(secureDir, "link.key"),
    linkPairKey: join(secureDir, "link-pair.key"),
    linkUpstreamToken: join(secureDir, "link-upstream.token"),
    linkAllow: join(secureDir, "link-allow.json"),
    nodeId: join(home, "node-id"),
    linkDir: join(home, "link"),
    composioKey: join(home, "composio.key"),
    typesafeKey: join(home, "typesafe.key"),
    openaiKey: join(home, "openai.key"),
    rings: join(home, "rings"),
    sidecarEndpoint: join(home, "sidecar.json"),
    work: join(home, "work"),
    logs: join(home, "logs"),
  };
}

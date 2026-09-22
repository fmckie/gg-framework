// On-disk layout for the host. Everything lives under one state directory so
// uninstall is one rm and permissions are one chmod.
//
//   $KLEIO_HOST_HOME (default ~/Library/Application Support/Kleio/host)
//   ├── secure/                    0700
//   │   ├── headless-master.key    0600, 32 random bytes
//   │   ├── control-root.key       0600, macaroon root
//   │   └── device-registry.json   0600
//   ├── rings/                     per-session SSE replay files
//   ├── sidecar.json               0600, { port, token, pid } from the supervisor
//   ├── work/                      default cwd for the sidecar
//   └── logs/
import { homedir } from "node:os";
import { join } from "node:path";

export interface HostPaths {
  readonly home: string;
  readonly secureDir: string;
  readonly masterKey: string;
  readonly controlRootKey: string;
  readonly registry: string;
  readonly rings: string;
  readonly sidecarEndpoint: string;
  readonly work: string;
  readonly logs: string;
}

export function hostPaths(
  home = process.env.KLEIO_HOST_HOME ??
    join(homedir(), "Library", "Application Support", "Kleio", "host"),
): HostPaths {
  const secureDir = join(home, "secure");
  return {
    home,
    secureDir,
    masterKey: join(secureDir, "headless-master.key"),
    controlRootKey: join(secureDir, "control-root.key"),
    registry: join(secureDir, "device-registry.json"),
    rings: join(home, "rings"),
    sidecarEndpoint: join(home, "sidecar.json"),
    work: join(home, "work"),
    logs: join(home, "logs"),
  };
}

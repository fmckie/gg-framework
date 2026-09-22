#!/bin/sh
# Kleio host installer — run ON the Mac mini as the service user. Idempotent.
#
#   sh install-mini.sh            install/upgrade and start
#   sh install-mini.sh uninstall  stop and remove the Kleio host jobs (state kept)
#
# Layout: $HOME/kleio-host/{dist,sidecar,node_modules?}  (code, rsync'd from the laptop)
#         $HOME/Library/Application Support/Kleio/host   (state; see src/paths.ts)
#
# Two launchd jobs, so the proxy can be redeployed without killing runs:
#   com.kleio.host.sidecar  — kleio-host sidecar  (supervises app-sidecar.mjs)
#   com.kleio.host.serve    — kleio-host serve    (HTTP host on 127.0.0.1:8443)
# Tailscale Serve fronts :8443 with TLS + tailnet ACL.
set -eu

CODE="$HOME/kleio-host"
NODE="${KLEIO_NODE_BIN:-/opt/homebrew/bin/node}"
TS="${TAILSCALE_BIN:-/usr/local/bin/tailscale}"
PORT="${KLEIO_HOST_PORT:-8443}"
AGENTS="$HOME/Library/LaunchAgents"
UID_="$(id -u)"

# Old agents from earlier Kleio/Atlas generations. Retired here so the mini
# runs exactly one host. Their plists are moved aside, not deleted.
LEGACY_LABELS="com.kleio.host-spike com.kleio.ios-ws-server com.kleio.control com.kleio.bridge com.kleio.desktop-host com.atlas.host com.atlas.bridge com.atlas.control com.atlas.ios-ws-server com.atlas.video-feature com.atlas.hermes.gateway com.atlas.hermes.autoupdate com.hermes.gateway com.noledge.host com.noledge.gateway"
# Same generations, installed as root LaunchDaemons (PLAN.md §6). Files here are
# only writable with sudo; the script does what it can unprivileged and prints
# the exact command for the rest rather than failing or silently skipping.
LEGACY_DAEMON_GLOB="com.atlas.* com.hermes.* com.noledge.* com.kleio.desktop-host*"

# bootout returns before the job is actually gone; a bootstrap that races it
# fails with "Input/output error". Wait until launchd no longer lists the label.
bootout() {
  launchctl bootout "gui/$UID_/$1" 2>/dev/null || true
  i=0
  while launchctl print "gui/$UID_/$1" >/dev/null 2>&1; do
    i=$((i + 1)); [ "$i" -ge 100 ] && { echo "warning: $1 did not unload in 10s" >&2; break; }
    sleep 0.1
  done
}

retire_legacy() {
  mkdir -p "$AGENTS/retired-by-kleio-host"
  # Known labels first, then anything else in the user domain matching the old
  # families, so a plist this list never heard of is still retired.
  for f in $AGENTS/com.atlas.*.plist $AGENTS/com.hermes.*.plist $AGENTS/com.noledge.*.plist $AGENTS/com.kleio.*.plist; do
    [ -f "$f" ] || continue
    label=$(basename "$f" .plist)
    case " $label " in *" com.kleio.host.sidecar "*|*" com.kleio.host.serve "*) continue ;; esac
    LEGACY_LABELS="$LEGACY_LABELS $label"
  done
  for label in $(printf "%s\n" $LEGACY_LABELS | sort -u); do
    bootout "$label"
    if [ -f "$AGENTS/$label.plist" ]; then
      mv -f "$AGENTS/$label.plist" "$AGENTS/retired-by-kleio-host/$label.plist"
      echo "retired $label"
    fi
  done
  # The old desktop app (Electron) bundle-launched its own servers; ask it to quit.
  if pgrep -x Kleio >/dev/null 2>&1; then
    osascript -e 'tell application "Kleio" to quit' 2>/dev/null || pkill -x Kleio || true
    echo "asked the old Kleio desktop app to quit"
  fi
  retire_legacy_daemons
}

retire_legacy_daemons() {
  found=""
  for pattern in $LEGACY_DAEMON_GLOB; do
    for f in /Library/LaunchDaemons/$pattern /Library/LaunchAgents/$pattern; do
      [ -e "$f" ] && found="$found $f"
    done
  done
  [ -n "$found" ] || return 0
  # Unload whatever is loaded in the system domain (no-op when already disabled).
  for f in $found; do
    label=$(/usr/libexec/PlistBuddy -c "Print :Label" "$f" 2>/dev/null || true)
    [ -n "$label" ] && sudo -n launchctl bootout "system/$label" 2>/dev/null && echo "unloaded system/$label"
  done
  dest=/Library/LaunchDaemons/retired-by-kleio-host
  if sudo -n mkdir -p "$dest" 2>/dev/null; then
    for f in $found; do sudo -n mv -f "$f" "$dest/" && echo "retired $f"; done
  else
    echo
    echo "NOTE: root-owned legacy launchd files remain (loaded state: disabled):"
    for f in $found; do echo "   $f"; done
    echo "  They are not running and cannot start; to move them aside, run once as admin:"
    echo "    sudo mkdir -p $dest && sudo mv$found $dest/"
    echo
  fi
}

write_plist() { # label, subcommand, extra-env-xml
  cat > "$AGENTS/$1.plist" <<PL
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>$1</string>
  <key>ProgramArguments</key><array>
    <string>$NODE</string>
    <string>$CODE/dist/cli.js</string>
    <string>$2</string>
  </array>
  <key>EnvironmentVariables</key><dict>
    <key>PATH</key><string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string>
    <key>HOME</key><string>$HOME</string>
    <key>KLEIO_HOST_PORT</key><string>$PORT</string>
    <key>KLEIO_PUBLIC_URL</key><string>$PUBLIC_URL</string>
    <key>KLEIO_SIDECAR_PATH</key><string>$CODE/sidecar/app-sidecar.mjs</string>
    <key>KLEIO_NODE_BIN</key><string>$NODE</string>
$3
  </dict>
  <key>WorkingDirectory</key><string>$HOME</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>5</integer>
  <key>StandardOutPath</key><string>$STATE/logs/$2.out.log</string>
  <key>StandardErrorPath</key><string>$STATE/logs/$2.err.log</string>
</dict></plist>
PL
}

if [ "${1:-}" = "uninstall" ]; then
  bootout com.kleio.host.serve
  bootout com.kleio.host.sidecar
  rm -f "$AGENTS/com.kleio.host.serve.plist" "$AGENTS/com.kleio.host.sidecar.plist"
  "$TS" serve --https="$PORT" off 2>/dev/null || true
  echo "kleio-host jobs removed; state kept under Application Support/Kleio/host"
  exit 0
fi

[ -x "$NODE" ] || { echo "node not found at $NODE" >&2; exit 1; }
[ -x "$TS" ] || { echo "tailscale not found at $TS" >&2; exit 1; }
[ -f "$CODE/dist/cli.js" ] || { echo "missing $CODE/dist/cli.js (rsync the package first)" >&2; exit 1; }
# dist/ is ESM; without a package.json next to it Node reparses on every start.
[ -f "$CODE/package.json" ] || printf '{ "type": "module" }\n' > "$CODE/package.json"
[ -f "$CODE/sidecar/app-sidecar.mjs" ] || { echo "missing $CODE/sidecar/app-sidecar.mjs" >&2; exit 1; }

DNS_NAME="$("$TS" status --json | "$NODE" -pe 'JSON.parse(require("fs").readFileSync(0,"utf8")).Self.DNSName.replace(/\.$/,"")')"
PUBLIC_URL="https://$DNS_NAME:$PORT"
STATE="$HOME/Library/Application Support/Kleio/host"
mkdir -p "$STATE/logs"

retire_legacy

# Keys, registry, first admin token (prints once; idempotent afterwards).
KLEIO_HOST_PORT="$PORT" KLEIO_PUBLIC_URL="$PUBLIC_URL" "$NODE" "$CODE/dist/cli.js" init

write_plist com.kleio.host.sidecar sidecar ""
write_plist com.kleio.host.serve serve ""

# Restart both. The sidecar first so the endpoint file exists before serve reads it.
for label in com.kleio.host.sidecar com.kleio.host.serve; do
  bootout "$label"
  launchctl bootstrap "gui/$UID_" "$AGENTS/$label.plist"
  launchctl kickstart -k "gui/$UID_/$label"
  launchctl print "gui/$UID_/$label" >/dev/null 2>&1 || { echo "failed to start $label" >&2; exit 1; }
done

# Tailscale Serve: clear whatever was on this port, then front the host.
"$TS" serve --https="$PORT" off 2>/dev/null || true
"$TS" serve --bg --https="$PORT" "http://127.0.0.1:$PORT" >/dev/null

sleep 3
echo
echo "kleio-host installed."
echo "  public:  $PUBLIC_URL"
echo "  status:  $(curl -s "http://127.0.0.1:$PORT/kleio/health" || echo '(not yet up)')"
echo "  pair:    $NODE $CODE/dist/cli.js pair"

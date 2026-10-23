#!/bin/sh
# Kleio host installer — run ON the Mac mini as the service user. Idempotent.
#
#   sh install-mini.sh            install/upgrade and start
#   sh install-mini.sh uninstall  stop and remove the Kleio host jobs (state kept)
#   sh install-mini.sh cli        only (re)install the `kleio-host` command; no restarts
#
# Layout: $HOME/kleio-host/{dist,sidecar,bin,node_modules?}  (code, rsync'd from the laptop;
#                                                         bin/kleio-link-host is Kleio's link)
#         $HOME/Library/Application Support/Kleio/host   (state; see src/paths.ts)
#
# Three launchd jobs, so the proxy can be redeployed without killing runs or
# dropping phones:
#   com.kleio.host.sidecar  — kleio-host sidecar  (supervises app-sidecar.mjs)
#   com.kleio.host.serve    — kleio-host serve    (HTTP host on 127.0.0.1:8443,
#                                                  site previews on 127.0.0.1:8444,
#                                                  the link listener on 127.0.0.1:8445)
#   com.kleio.host.link     — kleio-link-host serve (Kleio's link: paired phones,
#                                                  through a relay or directly,
#                                                  to the link listener)
# The link job restarts only when kleio-link-host or its job changed, so
# phones stay connected through a deploy of kleio-host alone.
#
# When Tailscale is installed, Tailscale Serve fronts the API and preview
# ports with TLS + tailnet ACL, for devices paired over Tailscale and for site
# previews. The preview port is a separate browser origin so agent-written
# pages can never reach the API. Without Tailscale, phones pair and connect
# over the link alone, and there are no site previews: they need Tailscale
# for now.
set -eu

CODE="$HOME/kleio-host"
NODE="${KLEIO_NODE_BIN:-/opt/homebrew/bin/node}"
TS="${TAILSCALE_BIN:-/usr/local/bin/tailscale}"
PORT="${KLEIO_HOST_PORT:-8443}"
PREVIEW_PORT="${KLEIO_PREVIEW_PORT:-8444}"
LINK_PORT="${KLEIO_LINK_PORT:-8445}"
LINK_BIN="$CODE/bin/kleio-link-host"
LINK_LABEL="com.kleio.host.link"
# What the link job was last started with (a hash of kleio-link-host and its
# plist), so an install that changes neither leaves it running.
LINK_STARTED="$CODE/.link-job"
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
    case " $label " in *" com.kleio.host.sidecar "*|*" com.kleio.host.serve "*|*" com.kleio.host.link "*) continue ;; esac
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

# Push notifications (src/apns.ts) are on when the Apple key and its settings
# sit in the host's secrets folder:
#   $STATE/secrets/apns.p8   the .p8 key from developer.apple.com
#   $STATE/secrets/apns.env  KLEIO_APNS_KEY_ID=, KLEIO_APNS_TEAM_ID=,
#                            KLEIO_APNS_BUNDLE_ID=, KLEIO_APNS_ENV= (sandbox|production)
# They go into the serve job on every install, so a reinstall never silently
# turns notifications off again. Prints the plist XML; nothing when absent.
apns_env_xml() {
  secrets="$STATE/secrets"
  [ -f "$secrets/apns.p8" ] && [ -f "$secrets/apns.env" ] || return 0
  printf '    <key>KLEIO_APNS_KEY_PATH</key><string>%s</string>\n' "$secrets/apns.p8"
  while IFS='=' read -r key value || [ -n "$key" ]; do
    case "$key" in
      '' | '#'*) continue ;;
      KLEIO_APNS_KEY_ID | KLEIO_APNS_TEAM_ID | KLEIO_APNS_BUNDLE_ID | KLEIO_APNS_ENV) ;;
      *) echo "apns.env: unknown setting $key" >&2; return 1 ;;
    esac
    case "$value" in
      '' | *[!A-Za-z0-9._-]*) echo "apns.env: bad value for $key" >&2; return 1 ;;
    esac
    printf '    <key>%s</key><string>%s</string>\n' "$key" "$value"
  done < "$secrets/apns.env"
}

# A `kleio-host` command for login and SSH shells (`kleio-host pair`, `devices`,
# `revoke`), running the same node and cli.js as the launchd jobs. It goes in a
# folder the user owns (no sudo), and that folder joins PATH in ~/.zprofile,
# which zsh login shells (Terminal, `ssh mini`, `zsh -lc`) read. Both steps
# are skipped when already done, so re-running changes nothing.
BIN_DIR="$HOME/.local/bin"
PATH_LINE='export PATH="$HOME/.local/bin:$PATH"  # kleio-host command'
install_cli() {
  mkdir -p "$BIN_DIR"
  tmp="$BIN_DIR/.kleio-host.$$"
  cat > "$tmp" <<SH
#!/bin/sh
# Written by kleio-host install-mini.sh; re-run it to update.
KLEIO_HOST_PORT="\${KLEIO_HOST_PORT:-$PORT}" exec "$NODE" "$CODE/dist/cli.js" "\$@"
SH
  chmod 755 "$tmp"
  mv -f "$tmp" "$BIN_DIR/kleio-host"
  touch "$HOME/.zprofile"
  if ! grep -Fq "$PATH_LINE" "$HOME/.zprofile"; then
    printf '\n%s\n' "$PATH_LINE" >> "$HOME/.zprofile"
    echo "added ~/.local/bin to PATH in ~/.zprofile"
  fi
  echo "command: $BIN_DIR/kleio-host"
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
    <key>KLEIO_PREVIEW_PORT</key><string>$PREVIEW_PORT</string>
    <key>KLEIO_LINK_PORT</key><string>$LINK_PORT</string>
$URL_XML
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

# The tailnet addresses, for the plists; nothing on a host without Tailscale.
url_env_xml() {
  [ -n "$PUBLIC_URL" ] || return 0
  printf '    <key>KLEIO_PUBLIC_URL</key><string>%s</string>\n' "$PUBLIC_URL"
  printf '    <key>KLEIO_PREVIEW_URL</key><string>%s</string>\n' "$PREVIEW_URL"
}

# kleio-link-host serve, with kleio-host's state folder (the link's key, its
# secret and the allow-list) and kleio-host's link listener.
write_link_plist() {
  cat > "$AGENTS/$LINK_LABEL.plist" <<PL
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>$LINK_LABEL</string>
  <key>ProgramArguments</key><array>
    <string>$LINK_BIN</string>
    <string>serve</string>
    <string>--state-dir</string>
    <string>$STATE</string>
    <string>--upstream</string>
    <string>127.0.0.1:$LINK_PORT</string>
  </array>
  <key>EnvironmentVariables</key><dict>
    <key>PATH</key><string>/usr/bin:/bin</string>
    <key>HOME</key><string>$HOME</string>
  </dict>
  <key>WorkingDirectory</key><string>$HOME</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>5</integer>
  <key>StandardOutPath</key><string>$STATE/logs/link.out.log</string>
  <key>StandardErrorPath</key><string>$STATE/logs/link.err.log</string>
</dict></plist>
PL
}

# A hash of what the link job runs: kleio-link-host and its plist.
link_sum() {
  cat "$LINK_BIN" "$AGENTS/$LINK_LABEL.plist" | shasum -a 256 | cut -d ' ' -f 1
}

link_running() {
  launchctl print "gui/$UID_/$LINK_LABEL" 2>/dev/null | grep -q '^[[:blank:]]state = running$'
}

restart() {
  bootout "$1"
  launchctl bootstrap "gui/$UID_" "$AGENTS/$1.plist"
  launchctl kickstart -k "gui/$UID_/$1"
  launchctl print "gui/$UID_/$1" >/dev/null 2>&1 || { echo "failed to start $1" >&2; exit 1; }
}

if [ "${1:-}" = "uninstall" ]; then
  bootout "$LINK_LABEL"
  bootout com.kleio.host.serve
  bootout com.kleio.host.sidecar
  rm -f "$AGENTS/$LINK_LABEL.plist" "$AGENTS/com.kleio.host.serve.plist" "$AGENTS/com.kleio.host.sidecar.plist" "$LINK_STARTED"
  if [ -x "$TS" ]; then
    "$TS" serve --https="$PORT" off 2>/dev/null || true
    "$TS" serve --https="$PREVIEW_PORT" off 2>/dev/null || true
  fi
  echo "kleio-host jobs removed; state kept under Application Support/Kleio/host"
  exit 0
fi

[ -x "$NODE" ] || { echo "node not found at $NODE" >&2; exit 1; }

if [ "${1:-}" = "cli" ]; then
  install_cli
  exit 0
fi

[ -f "$CODE/dist/cli.js" ] || { echo "missing $CODE/dist/cli.js (rsync the package first)" >&2; exit 1; }
# dist/ is ESM; without a package.json next to it Node reparses on every start.
[ -f "$CODE/package.json" ] || printf '{ "type": "module" }\n' > "$CODE/package.json"
[ -f "$CODE/sidecar/app-sidecar.mjs" ] || { echo "missing $CODE/sidecar/app-sidecar.mjs" >&2; exit 1; }
[ -x "$LINK_BIN" ] || { echo "missing $LINK_BIN (Kleio's link: deploy-mini.sh builds and copies it; see the README)" >&2; exit 1; }

# Tailscale, when it's installed: this Mac's name on the tailnet, for devices
# paired over Tailscale and for site previews.
PUBLIC_URL=""
PREVIEW_URL=""
if [ -x "$TS" ]; then
  DNS_NAME="$("$TS" status --json | "$NODE" -pe 'JSON.parse(require("fs").readFileSync(0,"utf8")).Self.DNSName.replace(/\.$/,"")')" ||
    { echo "tailscale is installed ($TS), but its status can't be read: start it and sign in, then re-run" >&2; exit 1; }
  [ -n "$DNS_NAME" ] || { echo "tailscale has no name for this Mac yet: sign in, then re-run" >&2; exit 1; }
  PUBLIC_URL="https://$DNS_NAME:$PORT"
  PREVIEW_URL="https://$DNS_NAME:$PREVIEW_PORT"
else
  echo "tailscale: not installed ($TS), so phones pair and connect over Kleio's link alone, with no site previews"
fi
URL_XML="$(url_env_xml)"
STATE="$HOME/Library/Application Support/Kleio/host"
mkdir -p "$STATE/logs"

retire_legacy

# Keys (the link's too), registry, first admin token (prints once; idempotent
# afterwards).
KLEIO_HOST_PORT="$PORT" KLEIO_PUBLIC_URL="$PUBLIC_URL" "$NODE" "$CODE/dist/cli.js" init
# kleio-link-host runs on this Mac and takes the link's key as init left it.
"$LINK_BIN" id --state-dir "$STATE" >/dev/null ||
  { echo "kleio-link-host ($LINK_BIN) can't run here, or refuses the link's key: see above" >&2; exit 1; }

install_cli

APNS_XML="$(apns_env_xml)" || { echo "fix $STATE/secrets/apns.env and re-run" >&2; exit 1; }
[ -n "$APNS_XML" ] && echo "push notifications: on" || echo "push notifications: off (no secrets/apns.env)"

write_plist com.kleio.host.sidecar sidecar ""
write_plist com.kleio.host.serve serve "$APNS_XML"
write_link_plist

# Restart the sidecar first so the endpoint file exists before serve reads it,
# then serve.
for label in com.kleio.host.sidecar com.kleio.host.serve; do
  restart "$label"
done
# Then the link, only when kleio-link-host or its job changed, or it isn't
# running: it reads kleio-host's secret and allow-list again by itself, so
# kleio-host restarting doesn't need it to.
LINK_NOW="$(link_sum)"
if [ "$LINK_NOW" = "$(cat "$LINK_STARTED" 2>/dev/null || true)" ] && link_running; then
  echo "$LINK_LABEL: unchanged, left running so phones stay connected"
else
  rm -f "$LINK_STARTED"
  restart "$LINK_LABEL"
  printf '%s\n' "$LINK_NOW" > "$LINK_STARTED"
fi

# Tailscale Serve, with Tailscale: clear whatever was on each port, then front
# the host's API and its site-preview origin. Serve only (tailnet), never Funnel.
if [ -n "$PUBLIC_URL" ]; then
  for p in "$PORT" "$PREVIEW_PORT"; do
    "$TS" serve --https="$p" off 2>/dev/null || true
    "$TS" serve --bg --https="$p" "http://127.0.0.1:$p" >/dev/null
  done
fi

sleep 3
echo
echo "kleio-host installed."
if [ -n "$PUBLIC_URL" ]; then
  echo "  public:  $PUBLIC_URL"
  echo "  preview: $PREVIEW_URL"
else
  echo "  public:  none: without Tailscale, phones use Kleio's link alone"
  echo "  preview: none: site previews need Tailscale for now"
fi
echo "  status:  $(curl -s "http://127.0.0.1:$PORT/kleio/health" || echo '(not yet up)')"
# kleio-host's own words for the link: running or not, on which relay, its key.
"$BIN_DIR/kleio-host" status 2>/dev/null | sed -n '/^link: /,$p' | sed 's/^/  /' || true
echo "  pair:    kleio-host pair   (new shells; or $BIN_DIR/kleio-host pair)"

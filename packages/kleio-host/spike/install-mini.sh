#!/bin/sh
# Kleio host SPIKE installer — run ON the mini. Idempotent. Does not touch the old
# atlas-*/kleio-* agents (Step 3's installer will retire those).
set -eu
HOME_DIR="$HOME/kleio-host-spike"
LABEL="com.kleio.host-spike"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
NODE="${KLEIO_NODE_BIN:-/opt/homebrew/bin/node}"
mkdir -p "$HOME_DIR/logs" "$HOME_DIR/work"
[ -f "$HOME_DIR/device-token" ] || { "$NODE" -pe "require('crypto').randomBytes(24).toString('hex')" > "$HOME_DIR/device-token"; chmod 600 "$HOME_DIR/device-token"; }
TOKEN=$(cat "$HOME_DIR/device-token")
cat > "$PLIST" <<PL
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key><array>
    <string>$NODE</string>
    <string>$HOME_DIR/host.mjs</string>
  </array>
  <key>EnvironmentVariables</key><dict>
    <key>KLEIO_HOST_PORT</key><string>8443</string>
    <key>KLEIO_DEVICE_TOKEN</key><string>$TOKEN</string>
    <key>KLEIO_SIDECAR_PATH</key><string>$HOME_DIR/sidecar/app-sidecar.mjs</string>
    <key>KLEIO_SIDECAR_CWD</key><string>$HOME_DIR/work</string>
    <key>KLEIO_NODE_BIN</key><string>$NODE</string>
    <key>PATH</key><string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string>
    <key>HOME</key><string>$HOME</string>
  </dict>
  <key>WorkingDirectory</key><string>$HOME_DIR/work</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>5</integer>
  <key>StandardOutPath</key><string>$HOME_DIR/logs/host.out.log</string>
  <key>StandardErrorPath</key><string>$HOME_DIR/logs/host.err.log</string>
</dict></plist>
PL
UID_=$(id -u)
launchctl bootout "gui/$UID_/$LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$UID_" "$PLIST"
launchctl kickstart -k "gui/$UID_/$LABEL"
/usr/local/bin/tailscale serve --bg --https=8443 http://127.0.0.1:8443 >/dev/null
echo "installed $LABEL; serve:"; /usr/local/bin/tailscale serve status | grep -A1 8443

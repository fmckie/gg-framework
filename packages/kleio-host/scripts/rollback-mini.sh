#!/bin/sh
# Roll the Kleio host on the Mac mini back to the code deploy-mini.sh kept in
# ~/kleio-host/.prev. Run on the laptop:
#
#   sh packages/kleio-host/scripts/rollback-mini.sh [--dry-run]
#
# MINI is the SSH host (default mac-mini-1). HEALTH_WAIT is how many seconds
# step 4 waits (1 to 600, default 60). On the mini it:
#   1. Refuses unless .prev holds dist/cli.js and sidecar/app-sidecar.mjs.
#   2. Moves the current dist, sidecar, bin, install-mini.sh and launchd
#      plists aside to ~/kleio-host/.rolled-back-<UTC time>/ (nothing is
#      deleted), and puts .prev's copies in their place. .prev itself stays as
#      it is. A .prev from before Kleio's link has no bin/kleio-link-host and
#      no link job: the link job is stopped, and its plist goes aside too.
#   3. Restarts the launchd jobs the way install-mini.sh does: the sidecar,
#      then serve, then the link job if .prev has one.
#   4. Waits up to HEALTH_WAIT seconds for /kleio/health, and for
#      kleio-link-host to be on a relay if it's back, trying once a second,
#      then clears the deploy's in-progress mark and says which snapshot holds
#      the state.
#
# Code only: the host's state and ~/.gg stay as they are, the link's files
# included. Restoring a snapshot
# from ~/kleio-backups/ would drop pairings and chats made since, so it is a
# manual step (README, "Restore a state snapshot"). If the connection drops
# part-way, run this again: it starts from .prev each time.
#
#   --dry-run   print the script it would run on the mini, and run nothing
set -eu

DRY=0
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY=1 ;;
    -h | --help) sed -n '2,/^set -eu/p' "$0" | sed '$d' | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "rollback-mini: unknown option $arg" >&2; exit 2 ;;
  esac
done

MINI="${MINI:-mac-mini-1}"
case "$MINI" in
  '' | -* | *[!A-Za-z0-9._@-]*) echo "rollback-mini: MINI must be an SSH host name, not '$MINI'" >&2; exit 2 ;;
esac
HEALTH_WAIT="${HEALTH_WAIT:-60}"
case "$HEALTH_WAIT" in
  [1-9] | [1-9][0-9] | [1-5][0-9][0-9] | 600) ;;
  *) echo "rollback-mini: HEALTH_WAIT must be a whole number of seconds from 1 to 600, not '$HEALTH_WAIT'" >&2; exit 2 ;;
esac
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"

script() {
  printf 'STAMP=%s\nWAIT=%s\n' "$STAMP" "$HEALTH_WAIT"
  cat <<'EOF'
set -eu
umask 077
CODE="$HOME/kleio-host"
PREV="$CODE/.prev"
STATE="$HOME/Library/Application Support/Kleio/host"
AGENTS="$HOME/Library/LaunchAgents"
LABELS="com.kleio.host.sidecar com.kleio.host.serve"
LINK_LABEL="com.kleio.host.link"
MARK="$CODE/.deploy-in-progress"
BACKUPS="$HOME/kleio-backups"
UID_="$(id -u)"

for f in "$PREV/dist/cli.js" "$PREV/sidecar/app-sidecar.mjs"; do
  [ -f "$f" ] || { echo "Nothing to roll back to: $f is missing." >&2; exit 1; }
done
ASIDE="$CODE/.rolled-back-$STAMP"
mkdir "$ASIDE" "$ASIDE/LaunchAgents"

# APFS clones when the disk can make them, else copies.
CP="cp -Rp"
probe="$ASIDE/.clone-probe"
: > "$probe"
if cp -c "$probe" "$probe.copy" 2>/dev/null; then CP="cp -cRp"; fi
rm -f "$probe" "$probe.copy"

# bootout returns before the job is gone; a bootstrap racing it fails, so
# wait for it.
bootout() {
  launchctl bootout "gui/$UID_/$1" 2>/dev/null || true
  i=0
  while launchctl print "gui/$UID_/$1" >/dev/null 2>&1; do
    i=$((i + 1))
    if [ "$i" -ge 100 ]; then echo "warning: $1 did not unload in 10s" >&2; break; fi
    sleep 0.1
  done
}

# 2. .prev's copies go next to the live folders first, so the swap is renames.
# bin/ (kleio-link-host) only if .prev has one: from before Kleio's link it
# has none, and the live one goes aside with nothing in its place.
for d in dist sidecar bin; do
  [ ! -e "$CODE/.rollback-$d" ] || rm -rf "$CODE/.rollback-$d"
  [ ! -d "$PREV/$d" ] || $CP "$PREV/$d" "$CODE/.rollback-$d"
done
swapped=""
part_way() {
  status=$?
  [ "$status" = 0 ] && return 0
  echo "Rollback stopped part-way (swapped:${swapped:- nothing}). What it moved aside is in $ASIDE;" >&2
  echo ".prev is untouched, so running it again is safe." >&2
}
trap part_way EXIT
for d in dist sidecar bin; do
  [ ! -e "$CODE/$d" ] || mv "$CODE/$d" "$ASIDE/$d"
  [ ! -e "$CODE/.rollback-$d" ] || mv "$CODE/.rollback-$d" "$CODE/$d"
  swapped="$swapped $d"
done
if [ -f "$PREV/install-mini.sh" ]; then
  [ ! -f "$CODE/install-mini.sh" ] || mv "$CODE/install-mini.sh" "$ASIDE/install-mini.sh"
  cp -p "$PREV/install-mini.sh" "$CODE/install-mini.sh"
  swapped="$swapped install-mini.sh"
fi
for label in $LABELS; do
  [ -f "$PREV/LaunchAgents/$label.plist" ] || continue
  [ ! -f "$AGENTS/$label.plist" ] || cp -p "$AGENTS/$label.plist" "$ASIDE/LaunchAgents/$label.plist"
  cp -p "$PREV/LaunchAgents/$label.plist" "$AGENTS/.$label.plist.rollback"
  mv -f "$AGENTS/.$label.plist.rollback" "$AGENTS/$label.plist"
  swapped="$swapped $label.plist"
done
# The link job: .prev's, or stopped when .prev is from before Kleio's link.
LINK=0
if [ -f "$PREV/LaunchAgents/$LINK_LABEL.plist" ] && [ -x "$CODE/bin/kleio-link-host" ]; then
  [ ! -f "$AGENTS/$LINK_LABEL.plist" ] || cp -p "$AGENTS/$LINK_LABEL.plist" "$ASIDE/LaunchAgents/$LINK_LABEL.plist"
  cp -p "$PREV/LaunchAgents/$LINK_LABEL.plist" "$AGENTS/.$LINK_LABEL.plist.rollback"
  mv -f "$AGENTS/.$LINK_LABEL.plist.rollback" "$AGENTS/$LINK_LABEL.plist"
  swapped="$swapped $LINK_LABEL.plist"
  LINK=1
else
  bootout "$LINK_LABEL"
  if [ -f "$AGENTS/$LINK_LABEL.plist" ]; then
    mv -f "$AGENTS/$LINK_LABEL.plist" "$ASIDE/LaunchAgents/$LINK_LABEL.plist"
    swapped="$swapped $LINK_LABEL.plist"
    echo "$LINK_LABEL: stopped, as .prev is from before Kleio's link; its plist is in $ASIDE"
  fi
fi
# install-mini.sh restarts the link job next time, whatever runs now.
rm -f "$CODE/.link-job"
echo "code: back to .prev; what it replaced is in $ASIDE"

# 3. Restart the jobs as install-mini.sh does: the sidecar first, so the
# endpoint file exists before serve reads it, then serve, then the link.
restart() {
  bootout "$1"
  launchctl bootstrap "gui/$UID_" "$AGENTS/$1.plist"
  launchctl kickstart -k "gui/$UID_/$1"
  launchctl print "gui/$UID_/$1" >/dev/null 2>&1 || { echo "failed to start $1" >&2; exit 1; }
  echo "restarted $1"
}
for label in $LABELS; do restart "$label"; done
if [ "$LINK" = 1 ]; then restart "$LINK_LABEL"; fi
trap - EXIT

# 4. Healthy on the serve job's own port, and the link up if it's back?
PORT=8443
PLIST="$AGENTS/com.kleio.host.serve.plist"
if [ -f "$PLIST" ] && [ -x /usr/libexec/PlistBuddy ]; then
  p=$(/usr/libexec/PlistBuddy -c 'Print :EnvironmentVariables:KLEIO_HOST_PORT' "$PLIST" 2>/dev/null || true)
  case "$p" in '' | *[!0-9]*) ;; *) PORT=$p ;; esac
fi
LINK_STATE="$STATE/link/state.json"
# Up when the link job's own process is writing its state file (pretty JSON,
# a key a line), and that names the relay it's on.
link_up() {
  pid=$(launchctl print "gui/$UID_/$LINK_LABEL" 2>/dev/null | sed -n 's/^[[:blank:]]pid = \([0-9][0-9]*\)$/\1/p' | head -n 1)
  if [ -z "$pid" ]; then link="isn't running"; return 1; fi
  wrote=$(sed -n 's/^[[:blank:]]*"pid":[[:blank:]]*\([0-9][0-9]*\).*/\1/p' "$LINK_STATE" 2>/dev/null | head -n 1)
  if [ "$wrote" != "$pid" ]; then link="is running (pid $pid), but hasn't written its state yet"; return 1; fi
  relay=$(sed -n 's/^[[:blank:]]*"relay":[[:blank:]]*"\([^"]*\)".*/\1/p' "$LINK_STATE" | head -n 1)
  if [ -z "$relay" ]; then link="is running (pid $pid), but on no relay yet"; return 1; fi
  link="up (pid $pid), on $relay"
}
# At most WAIT tries, a second apart, and never past WAIT seconds.
end=$(( $(date +%s) + WAIT ))
tries=0
host=0
link_ok=1
link="not checked"
while :; do
  body=$(curl -s -m 2 "http://127.0.0.1:$PORT/kleio/health" 2>/dev/null || true)
  host=0
  case "$body" in *'"ok":true'*)
    case "$body" in *'"sidecar":"up"'*) host=1 ;; esac ;;
  esac
  if [ "$LINK" = 1 ]; then
    link_ok=0
    if link_up; then link_ok=1; fi
  fi
  if [ "$host" = 1 ] && [ "$link_ok" = 1 ]; then break; fi
  tries=$(( tries + 1 ))
  if [ "$tries" -ge "$WAIT" ] || [ "$(date +%s)" -ge "$end" ]; then break; fi
  sleep 1
done
if [ "$host" != 1 ] || [ "$link_ok" != 1 ]; then
  if [ "$host" != 1 ]; then echo "The host isn't healthy $WAIT s after the rollback (port $PORT)." >&2; fi
  if [ "$link_ok" != 1 ]; then echo "$WAIT s after the rollback, kleio-link-host $link." >&2; fi
  echo "The in-progress mark stays. Logs: ~/Library/Application Support/Kleio/host/logs/" >&2
  exit 1
fi
echo "healthy: ok, sidecar up (port $PORT)"
if [ "$LINK" = 1 ]; then echo "link: $link"; fi

backup=""
if [ -f "$MARK" ]; then
  backup=$(sed -n 's/^backup=//p' "$MARK")
  rm -f "$MARK"
  echo "cleared the deploy's in-progress mark"
fi
if [ -z "$backup" ] || [ ! -d "$backup" ]; then
  backup=""
  for d in "$BACKUPS"/*; do
    case "$d" in *.partial) continue ;; esac
    if [ -d "$d" ]; then backup="$d"; fi
  done
fi
echo "Rolled back. The host's state and ~/.gg were left as they are."
if [ -n "$backup" ]; then
  echo "The snapshot taken before the deploy: $backup (README: Restore a state snapshot)"
fi
EOF
}

if [ "$DRY" = 1 ]; then
  printf "+ ssh -o ConnectTimeout=15 %s sh -s <<'REMOTE'\n%s\nREMOTE\n" "$MINI" "$(script)"
  exit 0
fi
echo "rollback-mini: $MINI back to ~/kleio-host/.prev"
script | ssh -o ConnectTimeout=15 "$MINI" sh -s

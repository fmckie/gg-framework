#!/bin/sh
# Deploy the Kleio host from this checkout to the Mac mini, with a way back.
# Run on the laptop:
#
#   sh packages/kleio-host/scripts/deploy-mini.sh [--dry-run] [--no-build] [--force]
#
# MINI is the SSH host (default mac-mini-1). HEALTH_WAIT is how many seconds
# step 6 waits (1 to 600, default 60). In order:
#   1. Builds @kleio/coder and the packages it bundles from this checkout, then
#      the sidecar bundle from them, then the host and its page and PDF capture
#      helper (build-capture.sh, needs Xcode), as the README does.
#   2. Checks the mini, read-only: the code, state and launchd files are there,
#      there is room for a backup, and no earlier deploy was left unfinished.
#      It says which macOS the mini runs, and warns below macOS 14, where the
#      capture helper can't run (voice shows of web pages and PDFs fail; the
#      rest works).
#   3. Marks a deploy in progress (~/kleio-host/.deploy-in-progress) and keeps
#      the code that runs now in ~/kleio-host/.prev (dist, sidecar,
#      install-mini.sh and the two launchd plists) for rollback-mini.sh.
#   4. Snapshots the host's state folder and ~/.gg into ~/kleio-backups/<UTC
#      time>/ (0700: it holds keys and sign-ins, and never leaves the mini).
#      APFS clones where the disk allows, so it takes seconds and little space.
#   5. Copies the new code with the README's three rsync commands, then runs
#      install-mini.sh, which restarts both jobs.
#   6. Waits up to HEALTH_WAIT seconds for /kleio/health to say ok, with the
#      sidecar up, trying once a second.
#
# On success the in-progress mark goes. On failure it stays and the rollback
# command is printed; nothing is rolled back without you. Nothing is deleted
# either: snapshots, older .prev copies (.prev-<time>) and rolled-back code
# stay until you remove them, and the end of a deploy lists them with sizes.
#
#   --dry-run   print every command, local and remote, and run none
#   --no-build  deploy what is already built
#   --force     deploy although an earlier deploy didn't finish. If that deploy
#               had started changing the code, .prev keeps the code from before
#               it rather than taking what runs now.
set -eu

usage() {
  sed -n '2,/^set -eu/p' "$0" | sed '$d' | sed 's/^# \{0,1\}//'
}

DRY=0
BUILD=1
FORCE=0
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY=1 ;;
    --no-build) BUILD=0 ;;
    --force) FORCE=1 ;;
    -h | --help) usage; exit 0 ;;
    *) echo "deploy-mini: unknown option $arg" >&2; exit 2 ;;
  esac
done

MINI="${MINI:-mac-mini-1}"
case "$MINI" in
  '' | -* | *[!A-Za-z0-9._@-]*) echo "deploy-mini: MINI must be an SSH host name, not '$MINI'" >&2; exit 2 ;;
esac
HEALTH_WAIT="${HEALTH_WAIT:-60}"
case "$HEALTH_WAIT" in
  [1-9] | [1-9][0-9] | [1-5][0-9][0-9] | 600) ;;
  *) echo "deploy-mini: HEALTH_WAIT must be a whole number of seconds from 1 to 600, not '$HEALTH_WAIT'" >&2; exit 2 ;;
esac

REPO="$(cd "$(dirname "$0")/../../.." && pwd)"
[ -f "$REPO/packages/kleio-host/package.json" ] || { echo "deploy-mini: can't find the repo from $0" >&2; exit 2; }
cd "$REPO"

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
COMMIT="$(git rev-parse --short HEAD 2>/dev/null || echo unknown)"
[ "$COMMIT" = unknown ] || [ -z "$(git status --porcelain 2>/dev/null | head -n 1)" ] || COMMIT="$COMMIT-dirty"
case "$COMMIT" in *[!A-Za-z0-9-]*) COMMIT=unknown ;; esac

ROLLBACK="sh packages/kleio-host/scripts/rollback-mini.sh"
[ "$MINI" = mac-mini-1 ] || ROLLBACK="MINI=$MINI $ROLLBACK"

# Print a command, shell-quoted, the way it runs.
quote() {
  out=""
  for a in "$@"; do
    case "$a" in
      "" | *[!A-Za-z0-9_./:=@%+,-]*) a="'$(printf '%s' "$a" | sed "s/'/'\\\\''/g")'" ;;
    esac
    out="$out${out:+ }$a"
  done
  printf '%s' "$out"
}

# A local command: printed, then run unless --dry-run.
run() {
  printf '+ %s\n' "$(quote "$@")"
  [ "$DRY" = 1 ] || "$@"
}

# A script on stdin, run on the mini by sh: printed whole under --dry-run.
remote() {
  script="$(cat)"
  if [ "$DRY" = 1 ]; then
    printf "+ ssh -o ConnectTimeout=15 %s sh -s <<'REMOTE'   # %s\n%s\nREMOTE\n" "$MINI" "$1" "$script"
    return 0
  fi
  printf '+ ssh -o ConnectTimeout=15 %s sh -s   # %s\n' "$MINI" "$1"
  printf '%s\n' "$script" | ssh -o ConnectTimeout=15 "$MINI" sh -s
}

step() { printf '\n== %s\n' "$*"; }

# What every remote script starts with: this deploy's settings, then the
# mini's layout (install-mini.sh, src/paths.ts).
prelude() {
  printf 'MINI=%s\nSTAMP=%s\nFORCE=%s\nCOMMIT=%s\nWAIT=%s\n' "$MINI" "$STAMP" "$FORCE" "$COMMIT" "$HEALTH_WAIT"
  cat <<'EOF'
set -eu
CODE="$HOME/kleio-host"
STATE="$HOME/Library/Application Support/Kleio/host"
GG="$HOME/.gg"
AGENTS="$HOME/Library/LaunchAgents"
LABELS="com.kleio.host.sidecar com.kleio.host.serve"
MARK="$CODE/.deploy-in-progress"
BACKUPS="$HOME/kleio-backups"
files() { echo $(( $(find "$1" ! -type d | wc -l) )); }
EOF
}

# 2. Read-only: is the mini ready for this deploy?
preflight() {
  prelude
  cat <<'EOF'
problems=0
for f in "$CODE/dist/cli.js" "$CODE/sidecar/app-sidecar.mjs" "$CODE/install-mini.sh" \
  "$STATE" "$GG" "$AGENTS/com.kleio.host.sidecar.plist" "$AGENTS/com.kleio.host.serve.plist"; do
  [ -e "$f" ] || { echo "missing on the mini: $f" >&2; problems=1; }
done
[ "$problems" = 0 ] || echo "This script upgrades an installed host; install one by hand first (README)." >&2
if [ -e "$MARK" ]; then
  started=$(sed -n 's/^started=//p' "$MARK")
  if grep -qx 'code_changed=0' "$MARK"; then
    echo "A deploy started at ${started:-?} stopped before it changed any code (or is still running)." >&2
    [ "$FORCE" = 1 ] || echo "If no deploy is running, deploy again with --force." >&2
  else
    echo "A deploy started at ${started:-?} changed the code but didn't finish." >&2
    [ "$FORCE" = 1 ] || echo "Roll back with rollback-mini.sh, or deploy again with --force (.prev keeps the code from before it)." >&2
  fi
  if [ "$FORCE" = 1 ]; then echo "--force: going ahead." >&2; else problems=1; fi
fi
if [ "$problems" = 0 ]; then
  need=$(du -sk "$STATE" "$GG" "$CODE/dist" "$CODE/sidecar" | awk '{ s += $1 } END { print s }')
  free=$(df -Pk "$HOME" | awk 'NR == 2 { print $4 }')
  echo "state $(du -sh "$STATE" | cut -f1) ($(files "$STATE") files), ~/.gg $(du -sh "$GG" | cut -f1) ($(files "$GG") files), $(( free / 1048576 )) GB free"
  if [ "$free" -lt $(( need + 1048576 )) ]; then
    echo "Not enough room for a full copy of the state, ~/.gg and the code, with 1 GB to spare." >&2
    problems=1
  fi
fi
# The page and PDF capture helper needs macOS 14 (WebKit's proxy settings).
macos=$(sw_vers -productVersion 2>/dev/null || true)
major=${macos%%.*}
case "$major" in
  '' | *[!0-9]*) echo "Couldn't tell which macOS the mini runs; showing web pages and PDFs needs macOS 14 or later." >&2 ;;
  *)
    echo "macOS $macos"
    if [ "$major" -lt 14 ]; then
      echo "The mini runs macOS $macos: showing web pages and PDFs in a voice call needs macOS 14 or later. The rest of the host works." >&2
    fi
    ;;
esac
exit "$problems"
EOF
}

# 3 and 4: the in-progress mark, .prev, and the state snapshot.
prepare() {
  prelude
  cat <<'EOF'
umask 077
had_mark=0
suspect=0
if [ -e "$MARK" ]; then
  [ "$FORCE" = 1 ] || { echo "An earlier deploy didn't finish." >&2; exit 1; }
  had_mark=1
  grep -qx 'code_changed=0' "$MARK" || suspect=1
fi
mark() {
  printf 'started=%s\ncommit=%s\nbackup=%s\ncode_changed=%s\n' "$STAMP" "$COMMIT" "$BACKUPS/$STAMP" "$1" > "$MARK.tmp"
  mv -f "$MARK.tmp" "$MARK"
}
stopped() {
  status=$?
  [ "$status" = 0 ] && return 0
  [ ! -d "$CODE/.prev.new" ] || rm -rf "$CODE/.prev.new"
  [ "$had_mark" = 1 ] || rm -f "$MARK"
  echo "Stopped before any code changed; the mini runs what it ran before." >&2
  [ ! -d "$BACKUPS/$STAMP.partial" ] || echo "The unfinished snapshot is in $BACKUPS/$STAMP.partial." >&2
}
trap stopped EXIT
mark "$suspect"

# APFS clones when the disk can make them (instant, shared blocks), else copies.
mkdir -p "$BACKUPS"
chmod 700 "$BACKUPS"
mkdir "$BACKUPS/$STAMP.partial"
probe="$BACKUPS/$STAMP.partial/.clone-probe"
: > "$probe"
CP="cp -Rp"
if cp -c "$probe" "$probe.copy" 2>/dev/null; then CP="cp -cRp"; fi
rm -f "$probe" "$probe.copy"

# 3. The code that runs now, whole or not at all: .prev.new, then a rename.
if [ "$suspect" = 1 ]; then
  if [ -d "$CODE/.prev" ]; then
    echo ".prev: kept as it was (the code from before the unfinished deploy)"
  else
    echo ".prev: none, and the code on the mini may be the unfinished deploy's, so it isn't saved: there is nothing to roll back to"
  fi
else
  NEW="$CODE/.prev.new"
  [ ! -d "$NEW" ] || rm -rf "$NEW"
  mkdir "$NEW" "$NEW/LaunchAgents"
  $CP "$CODE/dist" "$NEW/dist"
  $CP "$CODE/sidecar" "$NEW/sidecar"
  cp -p "$CODE/install-mini.sh" "$NEW/install-mini.sh"
  for label in $LABELS; do cp -p "$AGENTS/$label.plist" "$NEW/LaunchAgents/$label.plist"; done
  printf '%s\n' "$STAMP" > "$NEW/.stamp"
  if [ -d "$CODE/.prev" ]; then
    old=$(cat "$CODE/.prev/.stamp" 2>/dev/null || true)
    case "$old" in '' | *[!0-9TZ]*) old="before-$STAMP" ;; esac
    [ ! -e "$CODE/.prev-$old" ] || old="$old-$STAMP"
    mv "$CODE/.prev" "$CODE/.prev-$old"
    echo "the last deploy's .prev: now .prev-$old"
  fi
  mv "$NEW" "$CODE/.prev"
  echo ".prev: the code that runs now (dist, sidecar, install-mini.sh, launchd plists)"
fi

# 4. The state snapshot. The host keeps running: the registry and keys are
# written whole (temp file, rename), but a ring file may catch an append.
snapshot() {
  $CP "$1" "$BACKUPS/$STAMP.partial/$2"
  have=$(files "$1")
  got=$(files "$BACKUPS/$STAMP.partial/$2")
  if [ "$have" != "$got" ]; then
    echo "The copy of $1 has $got files and the folder has $have now; it changed while copying. Deploy again." >&2
    return 1
  fi
  echo "$2: $got files from $1"
}
snapshot "$STATE" state
snapshot "$GG" gg
cat > "$BACKUPS/$STAMP.partial/manifest.txt" <<MANIFEST
Kleio host snapshot, taken by deploy-mini.sh before deploying $COMMIT.
Taken: $STAMP (UTC), with the host running.
state/  = $STATE
gg/     = $GG
The code that ran with it: $CODE/.prev (or .prev-$STAMP once a later deploy replaces it).
Restoring it replaces pairings and chats made since: see "Restore a state snapshot" in
packages/kleio-host/README.md.
MANIFEST
[ ! -e "$BACKUPS/$STAMP" ] || { echo "$BACKUPS/$STAMP already exists" >&2; exit 1; }
mv "$BACKUPS/$STAMP.partial" "$BACKUPS/$STAMP"
echo "snapshot: $BACKUPS/$STAMP"

# From here on the code may change: a stop means rollback-mini.sh.
mark 1
EOF
}

# 6. Waits for the host to answer, healthy, on its own port.
health() {
  prelude
  cat <<'EOF'
PORT=8443
PLIST="$AGENTS/com.kleio.host.serve.plist"
if [ -f "$PLIST" ] && [ -x /usr/libexec/PlistBuddy ]; then
  p=$(/usr/libexec/PlistBuddy -c 'Print :EnvironmentVariables:KLEIO_HOST_PORT' "$PLIST" 2>/dev/null || true)
  case "$p" in '' | *[!0-9]*) ;; *) PORT=$p ;; esac
fi
# At most WAIT tries, a second apart, and never past WAIT seconds.
end=$(( $(date +%s) + WAIT ))
tries=0
body=""
while :; do
  body=$(curl -s -m 2 "http://127.0.0.1:$PORT/kleio/health" 2>/dev/null || true)
  case "$body" in *'"ok":true'*)
    case "$body" in *'"sidecar":"up"'*) echo "healthy: ok, sidecar up (port $PORT)"; exit 0 ;; esac ;;
  esac
  tries=$(( tries + 1 ))
  if [ "$tries" -ge "$WAIT" ] || [ "$(date +%s)" -ge "$end" ]; then break; fi
  sleep 1
done
if [ -z "$body" ]; then
  why="no answer"
else
  why="sidecar $(printf '%s' "$body" | sed -n 's/.*"sidecar":"\([a-z]*\)".*/\1/p')"
fi
echo "Not healthy after $WAIT s on port $PORT: $why" >&2
exit 1
EOF
}

# The end of a good deploy: the mark goes; what's kept is listed.
finish() {
  prelude
  cat <<'EOF'
rm -f "$MARK"
echo "deployed $COMMIT; state snapshot $BACKUPS/$STAMP"
echo "Kept on the mini (sizes count cloned blocks in full; this script deletes none of them):"
for d in "$BACKUPS"/* "$CODE"/.prev "$CODE"/.prev-* "$CODE"/.rolled-back-*; do
  if [ -e "$d" ]; then du -sh "$d"; fi
done
echo "Remove one with: ssh $MINI 'rm -rf <path>'"
EOF
}

fail() {
  echo "deploy-mini: $*" >&2
  exit 1
}

# How far this deploy got, for what to say if it stops: before (nothing on the
# mini changed but .prev and a snapshot), code (the code may have changed),
# done (healthy).
PHASE=before
stopped() {
  status=$?
  [ "$status" != 0 ] || return 0
  if [ "$PHASE" = code ]; then
    echo >&2
    echo "The new code may be partly in place on $MINI, and the in-progress mark stays," >&2
    echo "so another deploy won't replace .prev with it. State snapshot: ~/kleio-backups/$STAMP." >&2
    echo "To go back to the code that ran before:  $ROLLBACK" >&2
  fi
}
trap stopped EXIT
trap 'exit 130' INT TERM HUP

flags=""
if [ "$FORCE" = 1 ]; then flags="$flags (--force)"; fi
if [ "$DRY" = 1 ]; then flags="$flags (dry run: nothing runs)"; fi
echo "deploy-mini: $COMMIT to $MINI$flags"
if [ "$DRY" = 0 ]; then
  for tool in ssh rsync; do
    command -v "$tool" >/dev/null 2>&1 || fail "$tool isn't installed here"
  done
fi

step "1/6 build"
if [ "$BUILD" = 1 ]; then
  # The bundle is made from the dist folders of @kleio/coder and the workspace
  # packages it uses; build them from this checkout, or an older build ships.
  run pnpm --filter '@kleio/coder...' build
  run node gg-app/scripts/bundle-sidecar.mjs
  run pnpm --filter @kleio/host build
  # After the host: its build empties dist/, where the helper goes.
  run sh packages/kleio-host/scripts/build-capture.sh
else
  echo "skipped (--no-build)"
fi
if [ "$DRY" = 0 ]; then
  for f in packages/kleio-host/dist/cli.js packages/kleio-host/dist/bin/kleio-capture gg-app/src-tauri/sidecar/app-sidecar.mjs packages/kleio-host/scripts/install-mini.sh; do
    [ -f "$f" ] || { echo "deploy-mini: missing $f; build first (or drop --no-build)" >&2; exit 1; }
  done
fi

step "2/6 check the mini (read-only)"
preflight | remote "check" || fail "nothing was changed on $MINI."

step "3-4/6 keep the running code in .prev; snapshot the state"
prepare | remote "save" || fail "stopped before any code changed on $MINI."

step "5/6 deploy"
PHASE=code
run rsync -az --delete packages/kleio-host/dist/ "$MINI:kleio-host/dist/" || fail "copying dist failed."
run rsync -az packages/kleio-host/scripts/install-mini.sh "$MINI:kleio-host/" || fail "copying install-mini.sh failed."
run rsync -az --delete gg-app/src-tauri/sidecar/ "$MINI:kleio-host/sidecar/" || fail "copying the sidecar failed."
run ssh -o ConnectTimeout=15 "$MINI" sh kleio-host/install-mini.sh || fail "install-mini.sh failed."

step "6/6 health"
health | remote "health" || fail "the host isn't healthy after the deploy."
PHASE="done"
finish | remote "finish" || fail "deployed and healthy, but the in-progress mark is still on $MINI: remove ~/kleio-host/.deploy-in-progress there."

#!/usr/bin/env bash
# Build Kleio for the paired iPhone, install it, launch it and check it stays up.
#
#   pnpm ios:device              # the phone must be unlocked
#   DEVICE=<udid> pnpm ios:device
#
# Two workarounds live in scripts/ios-swift-shim/swift, which goes first on PATH so
# that Tauri's swift-rs (it runs a bare `swift build`) picks it up:
# - Xcode 27.2's SwiftPM builds with the new "swiftbuild" engine by default. That
#   engine adds its own macOS SDK and target after swift-rs's iOS flags, so Tauri's
#   Swift package fails (AppKit/CoreServices "file not found"). The shim adds
#   `--build-system native`, which honours the iOS flags.
# - The home folder is a git repo. Without a ceiling, SwiftPM's `git` calls on
#   packages under ~/.cargo walk up into it and crawl the whole home folder. The
#   shim sets GIT_CEILING_DIRECTORIES=$HOME.
# CARGO_PROFILE_DEV_DEBUG=0 leaves out Rust debug info, which keeps target/ gigabytes smaller.
set -euo pipefail

cd "$(dirname "$0")/.."
DEVICE="${DEVICE:-00008140-001869AA3E8B001C}"
BUILD_DIR="src-tauri/gen/apple/build"
IPA="${BUILD_DIR}/arm64/Kleio.ipa"
WAIT_SECONDS=30
TMP="$(mktemp -d)"
trap 'rm -rf "${TMP}"' EXIT

base="$(git merge-base HEAD origin/main)"
echo "Based on origin/main $(git log -1 --format='%h %s (%cs)' "${base}")"
echo "HEAD $(git log -1 --format='%h %s' HEAD)$(git diff --quiet HEAD || echo ', with uncommitted changes')"

export PATH="${PWD}/scripts/ios-swift-shim:${PATH}"

# `tauri ios build` cannot replace its previous output, so clear it (gitignored build output).
rm -rf "${BUILD_DIR}/arm64" "${BUILD_DIR}/gg-app_iOS.xcarchive"
start=${SECONDS}
CARGO_PROFILE_DEV_DEBUG=0 npx tauri ios build --debug --ci --export-method debugging
echo "Build took $(((SECONDS - start) / 60))m $(((SECONDS - start) % 60))s"

bundle_id="$(unzip -p "${IPA}" 'Payload/*.app/Info.plist' | plutil -extract CFBundleIdentifier raw -)"

crash_logs() {
  xcrun devicectl device info files --device "${DEVICE}" --domain-type systemCrashLogs \
    --json-output "${TMP}/crash.json" >/dev/null
  python3 -I -c 'import json,sys
for f in json.load(open(sys.argv[1]))["result"]["files"]:
    if f["name"].startswith("Kleio"): print(f["name"])' "${TMP}/crash.json" | sort
}

crash_logs >"${TMP}/crashes-before"
xcrun devicectl device install app --device "${DEVICE}" "${IPA}"
xcrun devicectl device process launch --device "${DEVICE}" --terminate-existing \
  --json-output "${TMP}/launch.json" "${bundle_id}" >/dev/null
pid="$(python3 -I -c 'import json,sys
print(json.load(open(sys.argv[1]))["result"]["process"]["processIdentifier"])' "${TMP}/launch.json")"
echo "Launched ${bundle_id} (pid ${pid}); checking again in ${WAIT_SECONDS}s"
sleep "${WAIT_SECONDS}"

xcrun devicectl device info processes --device "${DEVICE}" --json-output "${TMP}/procs.json" >/dev/null
alive="$(python3 -I -c 'import json,sys
procs = json.load(open(sys.argv[1]))["result"]["runningProcesses"]
print(any(p["processIdentifier"] == int(sys.argv[2]) and p.get("executable", "").endswith("/Kleio") for p in procs))' \
  "${TMP}/procs.json" "${pid}")"
new_crashes="$(crash_logs | comm -13 "${TMP}/crashes-before" -)"

status=0
if [[ "${alive}" == "True" ]]; then
  echo "Alive after ${WAIT_SECONDS}s (pid ${pid})"
else
  echo "Kleio is not running ${WAIT_SECONDS}s after launch" >&2
  status=1
fi
if [[ -n "${new_crashes}" ]]; then
  echo "New Kleio crash report(s) on the device:" >&2
  echo "${new_crashes}" >&2
  status=1
fi
exit "${status}"

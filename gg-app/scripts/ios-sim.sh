#!/usr/bin/env bash
# Build Kleio for the iPhone simulator, install it and launch it.
#
#   pnpm ios:sim                 # build + install + launch on the booted sim
#   SIM="iPhone 16 Pro" pnpm ios:sim
#
# `tauri ios build` cannot replace its own previous output (it fails with
# "failed to rename app ... Directory not empty"), so the last build is cleared
# first. Only gen/apple/build is touched, which is gitignored build output.
#
# The build is signed (team from tauri.ios.conf.json): an unsigned simulator
# app has no application-identifier, and iOS then refuses every Keychain write
# ("A required entitlement isn't present") — so pairing could never finish.
set -euo pipefail

cd "$(dirname "$0")/.."
BUNDLE_ID="com.atlas.ggcoder"
BUILD_DIR="src-tauri/gen/apple/build"
APP="${BUILD_DIR}/arm64-sim/Kleio.app"

rm -rf "${BUILD_DIR}/arm64-sim" "${BUILD_DIR}/gg-app_iOS.xcarchive"
npx tauri ios build --target aarch64-sim --debug --ci

# A named simulator if given, else whichever is booted.
SIM_ID="${SIM:-booted}"
if [[ "${SIM_ID}" != "booted" ]]; then
  xcrun simctl boot "${SIM_ID}" 2>/dev/null || true
fi
xcrun simctl terminate "${SIM_ID}" "${BUNDLE_ID}" 2>/dev/null || true
xcrun simctl install "${SIM_ID}" "${APP}"
xcrun simctl launch "${SIM_ID}" "${BUNDLE_ID}"

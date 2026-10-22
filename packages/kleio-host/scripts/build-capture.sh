#!/bin/sh
# Builds kleio-capture, the helper that draws web pages and PDF pages for a
# Kleio voice show (native/capture/main.swift), into dist/bin/kleio-capture:
# one universal (arm64 and x86_64) binary for macOS 14 or later, signed ad hoc.
# Run it after `pnpm --filter @kleio/host build`, which empties dist/.
#
#   sh packages/kleio-host/scripts/build-capture.sh
#
# It needs Xcode: the Command Line Tools' SDK can be too old for WebKit's
# proxy settings (macOS 14). DEVELOPER_DIR picks another Xcode.
set -eu

HERE="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$HERE/native/capture/main.swift"
OUT="$HERE/dist/bin/kleio-capture"
DEVELOPER_DIR="${DEVELOPER_DIR:-/Applications/Xcode.app/Contents/Developer}"
export DEVELOPER_DIR

[ "$(uname -s)" = Darwin ] || { echo "build-capture: builds on macOS only" >&2; exit 2; }
[ -d "$DEVELOPER_DIR" ] || {
  echo "build-capture: no Xcode at $DEVELOPER_DIR (install Xcode, or set DEVELOPER_DIR)" >&2
  exit 2
}
[ -f "$SRC" ] || { echo "build-capture: missing $SRC" >&2; exit 2; }

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
for arch in arm64 x86_64; do
  xcrun --sdk macosx swiftc -swift-version 5 -O -target "$arch-apple-macos14.0" \
    "$SRC" -o "$TMP/kleio-capture-$arch"
done
xcrun lipo -create "$TMP/kleio-capture-arm64" "$TMP/kleio-capture-x86_64" -output "$TMP/kleio-capture"
codesign --force --sign - "$TMP/kleio-capture"
"$TMP/kleio-capture" --version >/dev/null

mkdir -p "$(dirname "$OUT")"
chmod 755 "$TMP/kleio-capture"
mv -f "$TMP/kleio-capture" "$OUT"
echo "built $OUT ($(du -k "$OUT" | cut -f1) KB, $(xcrun lipo -archs "$OUT"))"

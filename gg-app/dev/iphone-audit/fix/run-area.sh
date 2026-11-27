#!/bin/bash
# bash dev/iphone-audit/fix/run-area.sh <area> : every scene of the area, in order. GG_AUDIT_DEVICES=phone for the phone alone.
cd "$(dirname "$0")/../../.." || exit 1
area="$1"
for f in dev/iphone-audit/"$area"/*.mjs; do
  case "$(basename "$f")" in common.mjs|data.mjs|digest.mjs|show.mjs|view.mjs|_*|report.mjs|sheet.mjs|b-util.mjs|b-sheet.mjs|00-probe.mjs) continue;; esac
  echo "### $f"
  node "$f" 2>&1 | grep -E '^(!!|== |PAGE SCROLLS)' 
done
echo "### done $area"

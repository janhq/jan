#!/usr/bin/env bash
# Swap in a non-stable channel's app icon sources before `yarn build:icon`.
# icon-<channel>.png is the Linux source. icon-<channel>-macos.png (.icns) and
# icon-<channel>-windows.png (.ico) are the platform sources; each falls back
# to icon-<channel>.png when a channel has none.
set -euo pipefail
channel="$1"
dir="$(dirname "$0")"
cp "$dir/icon-$channel.png" src-tauri/icons/icon.png
for platform in macos windows; do
  source="$dir/icon-$channel-$platform.png"
  [ -f "$source" ] || source="$dir/icon-$channel.png"
  cp "$source" "src-tauri/icons-$platform/icon.png"
done

#!/usr/bin/env bash
# Swap in a non-stable channel's app icon sources before `yarn build:icon`.
# icon-<channel>.png is the Windows/Linux source; icon-<channel>-macos.png is
# the macOS (.icns) source, falling back to the former when a channel has none.
set -euo pipefail
channel="$1"
dir="$(dirname "$0")"
cp "$dir/icon-$channel.png" src-tauri/icons/icon.png
macos="$dir/icon-$channel-macos.png"
[ -f "$macos" ] || macos="$dir/icon-$channel.png"
cp "$macos" src-tauri/icons-macos/icon.png

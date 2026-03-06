#!/usr/bin/env bash
set -euo pipefail

# wrapper script to pin linuxdeploy version and inject environment variables into the
# build process. Using a wrapper allows granular control over when environment
# variables are injected, and avoids tainting the system .cache

# move cache home to <project root>/.cache
export XDG_CACHE_HOME=${PWD}/.cache

LINUXDEPLOY_VER="1-alpha-20250213-2"
LINUXDEPLOY="$XDG_CACHE_HOME/tauri/linuxdeploy-$LINUXDEPLOY_VER-x86_64.AppImage"
SYMLINK="$XDG_CACHE_HOME/tauri/linuxdeploy-x86_64.AppImage"

mkdir -p "$XDG_CACHE_HOME/tauri"

if [ ! -f "$LINUXDEPLOY" ]; then
  GLOB_PATTERN="$XDG_CACHE_HOME/tauri/linuxdeploy-*-x86_64.AppImage"
  rm -f $GLOB_PATTERN
  wget "https://github.com/linuxdeploy/linuxdeploy/releases/download/$LINUXDEPLOY_VER/linuxdeploy-x86_64.AppImage" -O "$LINUXDEPLOY"
  chmod a+x "$LINUXDEPLOY"
fi

rm -f "$SYMLINK"
ln -s "$LINUXDEPLOY" "$SYMLINK"

"$@"
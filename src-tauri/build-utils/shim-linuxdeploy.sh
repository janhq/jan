#!/usr/bin/env bash
set -euo pipefail

ARCH="${ARCH:-"$(uname -m)"}"
case "$ARCH" in
  x86_64|amd64)        ARCH="x86_64"  ;;
  i386|i486|i586|i686) ARCH="i386"    ;;
  arm64|aarch64)       ARCH="aarch64" ;;
  arm*)                ARCH="armhf"   ;;               
esac

# wrapper script to pin linuxdeploy version and inject environment variables into the 
# build process. While yarn supports injecting environment vairables via env files,
# this applies to all yarn scripts. Using a wrapper allows granular control over
# when environment variables are injected, and avoids tainting the system .cache

# avoid redownloading corepack if possible
export COREPACK_HOME=${COREPACK_HOME:-${XDG_CACHE_HOME:-$HOME/.cache}/node/corepack}
# move cache home to <project root>/.cache
export XDG_CACHE_HOME=${PWD}/.cache

LINUXDEPLOY_VER="1-alpha-20251107-1"
LINUXDEPLOY="$XDG_CACHE_HOME/tauri/linuxdeploy-$LINUXDEPLOY_VER-${ARCH}.AppImage"
SYMLINK="$XDG_CACHE_HOME/tauri/linuxdeploy-${ARCH}.AppImage"

mkdir -p "$XDG_CACHE_HOME/tauri"

if [ ! -f "$LINUXDEPLOY" ]; then
  GLOB_PATTERN="$XDG_CACHE_HOME/tauri/linuxdeploy-*-${ARCH}.AppImage"
  rm -f $GLOB_PATTERN
  wget "https://github.com/linuxdeploy/linuxdeploy/releases/download/$LINUXDEPLOY_VER/linuxdeploy-${ARCH}.AppImage" -O "$LINUXDEPLOY"
  chmod a+x "$LINUXDEPLOY"
fi

rm -f "$SYMLINK"
ln -s "$LINUXDEPLOY" "$SYMLINK"

# linuxdeploy, its plugins and appimagetool are all AppImages, which mount
# themselves through FUSE and fail with no output at all where it is missing --
# and the GitHub-hosted images no longer ship libfuse2. Extracting instead is
# the documented fallback and costs a little disk on a host that has FUSE.
export APPIMAGE_EXTRACT_AND_RUN=1

# libggml-cuda.so needs libcuda.so.1, which comes with the NVIDIA driver, not the
# toolkit, and linuxdeploy fails on any dependency it cannot resolve. Resolve it
# to the toolkit's stub, and exclude it so the stub never lands in the AppImage:
# at runtime it has to be the user's driver.
CUDA_STUB="${CUDA_PATH:-}/lib/stubs/libcuda.so"
if [ -f "$CUDA_STUB" ]; then
  mkdir -p "$XDG_CACHE_HOME/cuda-stubs"
  cp "$CUDA_STUB" "$XDG_CACHE_HOME/cuda-stubs/libcuda.so.1"
  export LD_LIBRARY_PATH="$XDG_CACHE_HOME/cuda-stubs${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
  export LINUXDEPLOY_EXCLUDED_LIBRARIES="libcuda.so.1"
fi

"$@"
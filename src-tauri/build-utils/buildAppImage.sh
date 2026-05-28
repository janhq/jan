#!/bin/bash
set -euo pipefail

# Post-process the AppImage produced by `tauri build` so the bundled
# `bun` binary (and any other engine resources) are available inside the
# AppImage runtime. `tauri build` produces a barebones AppImage that
# does not know about resources we inject outside `tauri.linux.conf.json`,
# so we unpack the AppDir, drop the extras in, and repackage with
# upstream `appimagetool`.
#
# Product name is "Atomic Chat" (with a space) — preserve quoting
# everywhere or the spaces will silently break the build.

APPIMAGETOOL="./.cache/build-tools/appimagetool"
RELEASE_CHANNEL=${RELEASE_CHANNEL:-"stable"}
PRODUCT_NAME="Atomic Chat"

mkdir -p ./.cache/build-tools
if [ ! -x "${APPIMAGETOOL}" ]; then
  wget https://github.com/AppImage/appimagetool/releases/download/continuous/appimagetool-x86_64.AppImage -O "${APPIMAGETOOL}" \
    || { echo "Failed to download appimagetool."; exit 1; }
  chmod +x "${APPIMAGETOOL}"
fi

if [ "${RELEASE_CHANNEL}" != "stable" ]; then
  APP_DIR="./src-tauri/target/release/bundle/appimage/${PRODUCT_NAME}-${RELEASE_CHANNEL}.AppDir"
  LIB_DIR="${APP_DIR}/usr/lib/${PRODUCT_NAME}-${RELEASE_CHANNEL}/binaries"
else
  APP_DIR="./src-tauri/target/release/bundle/appimage/${PRODUCT_NAME}.AppDir"
  LIB_DIR="${APP_DIR}/usr/lib/${PRODUCT_NAME}/binaries"
fi

if [ ! -d "${APP_DIR}" ]; then
  echo "AppDir not found at: ${APP_DIR}"
  echo "Contents of bundle/appimage/:"
  ls -la ./src-tauri/target/release/bundle/appimage/ || true
  exit 1
fi

# Bundle additional resources in the AppDir without pulling in their
# dependencies (linuxdeploy would otherwise drag in libc / libstdc++
# copies we do not want).
cp ./src-tauri/resources/bin/bun "${APP_DIR}/usr/bin/bun"
mkdir -p "${LIB_DIR}/engines"

# Remove the AppImage produced by `tauri build` — we are about to
# repackage from the unpacked AppDir.
APP_IMAGE_FILE=$(ls ./src-tauri/target/release/bundle/appimage/ | grep -E '\.AppImage$' | head -1 || true)
if [ -n "${APP_IMAGE_FILE}" ]; then
  APP_IMAGE="./src-tauri/target/release/bundle/appimage/${APP_IMAGE_FILE}"
  echo "Removing tauri-produced AppImage: ${APP_IMAGE}"
  rm -f "${APP_IMAGE}"
else
  echo "No existing AppImage from tauri build; will create from scratch"
  APP_IMAGE="./src-tauri/target/release/bundle/appimage/${PRODUCT_NAME}.AppImage"
fi

# Repackage AppImage with our additional resources baked in.
"${APPIMAGETOOL}" "${APP_DIR}" "${APP_IMAGE}"

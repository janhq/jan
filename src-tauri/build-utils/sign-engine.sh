#!/usr/bin/env bash
# Signs the staged engine worker and the ggml libraries beside it.
#
# Tauri signs the app binary and the installers it produces, not the contents of
# `resources/`, so nothing else in the build signs these. On macOS that is fatal:
# notarization rejects a bundle containing an unsigned mach-o. On Windows it is
# not fatal but the installer then carries unsigned executable code, which is
# what AV heuristics and DLL-signature policies flag.
#
# JAN_ENGINE_REQUIRE_SIGNING=1 turns a missing identity or tool into an error.
# Release CI sets it; a developer build leaves it unset and is only warned, since
# an unsigned local worker runs fine.
set -uo pipefail

DEST="src-tauri/resources/bin"

give_up() {
  if [ "${JAN_ENGINE_REQUIRE_SIGNING:-0}" = "1" ]; then
    echo "error: $1" >&2
    echo "       JAN_ENGINE_REQUIRE_SIGNING=1, so the engine must be signed." >&2
    exit 1
  fi
  echo "warning: $1" >&2
  echo "         Skipping engine code signing." >&2
  exit 0
}

case "$(uname -s)" in
Darwin)
  identity=$(security find-identity -v -p codesigning 2>/dev/null \
    | grep "Developer ID Application" | head -1 | sed 's/.*"\(.*\)".*/\1/')
  [ -n "$identity" ] || give_up "no 'Developer ID Application' identity in the keychain."
  echo "Signing the engine with: $identity"
  signed=0
  for target in "$DEST/jan-llama-worker" "$DEST"/libggml*.dylib; do
    [ -f "$target" ] || continue
    # cmake stages the soname chain as symlinks. codesign follows them, so
    # signing every name would sign the same file three times.
    [ -L "$target" ] && continue
    codesign --force --options runtime --timestamp --sign "$identity" "$target" || exit 1
    codesign --verify --strict "$target" || exit 1
    signed=$((signed + 1))
  done
  [ "$signed" -gt 0 ] || give_up "no engine binaries in $DEST to sign."
  echo "Signed and verified $signed engine binaries"
  ;;
MINGW* | MSYS* | CYGWIN*)
  [ -n "${AZURE_KEY_VAULT_URI:-}" ] || give_up "AZURE_KEY_VAULT_URI is unset, so there is no certificate to sign with."
  command -v AzureSignTool >/dev/null 2>&1 \
    || give_up "AzureSignTool is not on PATH (dotnet tool install --global AzureSignTool)."
  signed=0
  # sign.ps1 is the same script tauri's signCommand runs, so the installer and
  # the binaries inside it are signed by one implementation.
  for target in "$DEST/jan-llama-worker.exe" "$DEST"/ggml*.dll; do
    [ -f "$target" ] || continue
    powershell -ExecutionPolicy Bypass -File src-tauri/sign.ps1 "$target" || exit 1
    signed=$((signed + 1))
  done
  [ "$signed" -gt 0 ] || give_up "no engine binaries in $DEST to sign."
  echo "Signed $signed engine binaries"
  ;;
esac

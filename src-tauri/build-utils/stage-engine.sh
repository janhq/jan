#!/usr/bin/env bash
# Stages the llama.cpp engine worker and the ggml runtime it needs into
# src-tauri/resources/bin, which is what tauri.<os>.conf.json bundles.
#
# The ggml compute backends are MODULE libraries loaded by name at runtime, and
# ggml resolves them against the *executable's own directory*
# (ggml/src/ggml-backend-reg.cpp: search paths are GGML_BACKEND_DIR, then the
# exe dir, then the cwd). So they have to sit next to jan-llama-worker, not
# merely somewhere in the bundle. libggml/libggml-base are ordinary shared
# libraries found via the rpath ($ORIGIN / @loader_path) build.rs emits, which
# resolves to the same directory.
set -euo pipefail

PROFILE="${JAN_ENGINE_PROFILE:-release}"
PLUGIN_DIR="src-tauri/plugins/tauri-plugin-llamacpp"
TARGET_DIR="${CARGO_TARGET_DIR:-$PLUGIN_DIR/target}/$PROFILE"
DEST="src-tauri/resources/bin"

case "$(uname -s)" in
  MINGW*|MSYS*|CYGWIN*) EXE=".exe"; LIBEXT="dll" ;;
  Darwin)               EXE="";     LIBEXT="dylib" ;;
  *)                    EXE="";     LIBEXT="so" ;;
esac

WORKER="$TARGET_DIR/jan-llama-worker$EXE"
if [ ! -f "$WORKER" ]; then
  echo "stage-engine: $WORKER not found; run the cargo build first" >&2
  exit 1
fi

mkdir -p "$DEST"
install -m755 "$WORKER" "$DEST/jan-llama-worker$EXE"
echo "stage-engine: staged jan-llama-worker$EXE"

# build.rs installs the ggml prefix under the build script's OUT_DIR. Take the
# newest match so a stale prefix from an earlier variant is never picked.
PREFIX="$(find "$TARGET_DIR/build" -maxdepth 3 -type d -name ggml-prefix -print0 2>/dev/null \
  | xargs -0 -r ls -dt 2>/dev/null | head -1 || true)"
if [ -z "$PREFIX" ]; then
  echo "stage-engine: no ggml-prefix found under $TARGET_DIR/build" >&2
  echo "stage-engine: was the worker built with an engine-* feature?" >&2
  exit 1
fi

# Backend modules live in bin/, the core libraries in lib/ (see build.rs).
#
# cp -P, not install: cmake ships libggml.so -> .so.0 -> .so.0.21.0 as symlinks,
# and `install` dereferences them, writing three full copies of every core
# library. Preserving the links keeps the soname chain the loader expects and
# stops the bundle carrying the same bytes three times.
staged=0
for src in "$PREFIX"/bin/*."$LIBEXT"* "$PREFIX"/lib/libggml*."$LIBEXT"*; do
  [ -e "$src" ] || [ -L "$src" ] || continue
  cp -Pf "$src" "$DEST/$(basename "$src")"
  [ -L "$src" ] || chmod 644 "$DEST/$(basename "$src")"
  staged=$((staged + 1))
done

if [ "$staged" -eq 0 ]; then
  echo "stage-engine: found $PREFIX but no ggml libraries in it" >&2
  exit 1
fi

cpu_variants=$(find "$DEST" -name "*ggml-cpu-*.$LIBEXT*" | wc -l | tr -d ' ')
echo "stage-engine: staged $staged ggml libraries ($cpu_variants CPU variants) into $DEST"

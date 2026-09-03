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
#
# A CUDA module additionally links the toolkit's cudart/cublas/cublasLt at
# load time, and nothing on a user's machine provides those (the driver ships
# libcuda only). They are copied out of the build host's toolkit beside the
# module, so the bundle's tauri.<os>.conf.json globs are lib*.so* / *.dll rather
# than libggml*: a Vulkan-only bundle has no cudart to match, and the bundler
# treats a glob with zero matches as an error.
set -euo pipefail

# Positional first: cmd.exe has no `VAR=value command` prefix, so the Windows
# recipes pass the profile as an argument. The env var stays for callers that
# already set it.
PROFILE="${1:-${JAN_ENGINE_PROFILE:-release}}"
PLUGIN_DIR="src-tauri/plugins/tauri-plugin-llamacpp"
TARGET_DIR="${CARGO_TARGET_DIR:-$PLUGIN_DIR/target}/$PROFILE"
DEST="src-tauri/resources/bin"

# Two extensions, not one. The core libraries (libggml, libggml-base) are
# SHARED, but under GGML_BACKEND_DL every compute backend is a CMake MODULE
# library -- and CMake gives a MODULE the `.so` suffix on macOS too, which is
# also the only extension ggml's own loader looks for there
# (ggml/src/ggml-backend-reg.cpp: backend_filename_extension() is `.dll` on
# Windows and `.so` everywhere else, with no __APPLE__ case). Staging only
# `.dylib` on Darwin therefore ships the two core libraries and not one single
# backend, so Metal and every CPU variant go missing silently -- the loader runs
# with silent=true under NDEBUG.
case "$(uname -s)" in
  MINGW*|MSYS*|CYGWIN*) EXE=".exe"; LIBEXT="dll";   MODEXT="dll" ;;
  Darwin)               EXE="";     LIBEXT="dylib"; MODEXT="so"  ;;
  *)                    EXE="";     LIBEXT="so";    MODEXT="so"  ;;
esac

WORKER="$TARGET_DIR/jan-llama-worker$EXE"
if [ ! -f "$WORKER" ]; then
  echo "stage-engine: $WORKER not found; run the cargo build first" >&2
  exit 1
fi

mkdir -p "$DEST"

# The bundle globs take whatever sits in DEST, so a module or runtime left by
# an earlier variant's staging would ship with this one.
purge_stale() {
  find "$DEST" -maxdepth 1 \( -name 'libggml*' -o -name 'ggml*.dll' \
    -o -name 'libcudart.so*' -o -name 'libcublas*.so*' \
    -o -name 'cudart64_*.dll' -o -name 'cublas*.dll' \) -exec rm -f {} +
}
purge_stale

install -m755 "$WORKER" "$DEST/jan-llama-worker$EXE"
echo "stage-engine: staged jan-llama-worker$EXE"

# Newest match only, so a stale artefact from an earlier variant is never
# picked.
newest() {
  find "$TARGET_DIR/build" -maxdepth 3 "$@" -print0 2>/dev/null \
    | xargs -0 -r ls -dt 2>/dev/null | head -1 || true
}

# build.rs normally installs the ggml prefix under the build script's OUT_DIR,
# but on Windows it relocates the cmake trees out of the target tree when
# OUT_DIR is too close to MAX_PATH. It records the root it chose in OUT_DIR.
PREFIX="$(newest -type d -name ggml-prefix)"
if [ -z "$PREFIX" ]; then
  MARKER="$(newest -type f -name engine-build-root.txt)"
  if [ -n "$MARKER" ]; then
    ROOT="$(tr -d '\r\n' < "$MARKER")"
    # The marker holds a native path; under Git Bash that is `C:\...`.
    if command -v cygpath >/dev/null 2>&1; then
      ROOT="$(cygpath -u "$ROOT")"
    fi
    if [ -d "$ROOT/ggml-prefix" ]; then
      PREFIX="$ROOT/ggml-prefix"
    fi
  fi
fi
if [ -z "$PREFIX" ]; then
  echo "stage-engine: no ggml-prefix found under $TARGET_DIR/build" >&2
  echo "stage-engine: was the worker built with an engine-* feature?" >&2
  exit 1
fi

# Backend modules live in bin/, the core libraries in lib/ (see build.rs).
#
# Only Darwin has two distinct extensions; elsewhere a second glob over the same
# suffix would list every file twice.
exts=("$LIBEXT")
[ "$MODEXT" = "$LIBEXT" ] || exts+=("$MODEXT")

srcs=()
for ext in "${exts[@]}"; do
  srcs+=("$PREFIX"/bin/*."$ext"* "$PREFIX"/lib/libggml*."$ext"*)
done

# cp -P, not install: cmake ships libggml.so -> .so.0 -> .so.0.21.0 as symlinks,
# and `install` dereferences them, writing three full copies of every core
# library. Preserving the links keeps the soname chain the loader expects and
# stops the bundle carrying the same bytes three times.
staged=0
modules=0
cuda_module=""
for src in "${srcs[@]}"; do
  [ -e "$src" ] || [ -L "$src" ] || continue
  name="$(basename "$src")"
  cp -Pf "$src" "$DEST/$name"
  [ -L "$src" ] || chmod 644 "$DEST/$name"
  staged=$((staged + 1))
  case "$name" in
    libggml.*|libggml-base.*|ggml.dll|ggml-base.dll) ;;
    libggml-cuda.*|ggml-cuda.dll) modules=$((modules + 1)); cuda_module="$DEST/$name" ;;
    *) modules=$((modules + 1)) ;;
  esac
done

if [ "$staged" -eq 0 ]; then
  echo "stage-engine: found $PREFIX but no ggml libraries in it" >&2
  exit 1
fi

# Asserted, not merely printed: the two core libraries alone make `staged`
# non-zero, so a run that staged no backend module at all would otherwise pass
# the check above and ship an app with no compute backend to load.
if [ "$modules" -eq 0 ]; then
  echo "stage-engine: staged $staged ggml libraries but no backend module" >&2
  echo "stage-engine: expected *.$MODEXT MODULE libraries in $PREFIX/bin" >&2
  exit 1
fi

echo "stage-engine: staged $staged ggml libraries ($modules backend modules) into $DEST"

[ -n "$cuda_module" ] || exit 0

# The toolkit that compiled the module is the one to ship from: its runtime
# major matches by construction. CUDA_PATH is what the Windows installer sets,
# CUDA_HOME the usual Linux spelling, nvcc's parent the fallback for both.
cuda_root() {
  local d
  for d in "${CUDA_PATH:-}" "${CUDA_HOME:-}"; do
    if [ -n "$d" ] && [ -d "$d" ]; then echo "$d"; return 0; fi
  done
  local nvcc
  nvcc="$(command -v nvcc 2>/dev/null || true)"
  [ -n "$nvcc" ] || return 1
  (cd "$(dirname "$nvcc")/.." && pwd)
}

ROOT="$(cuda_root)" || {
  echo "stage-engine: staged $(basename "$cuda_module") but found no CUDA toolkit" >&2
  echo "stage-engine: set CUDA_PATH/CUDA_HOME or put nvcc on PATH to stage its runtime" >&2
  exit 1
}

# CUDA 13 moved the Windows DLLs from bin/ to bin/x64/. On Linux lib64 is a
# symlink to targets/<arch>/lib, so the first directory that holds cudart wins
# rather than copying the same files twice.
if [ "$LIBEXT" = "dll" ]; then
  candidates=("$ROOT/bin/x64" "$ROOT/bin")
  runtime_globs=('cudart64_*.dll' 'cublas64_*.dll' 'cublasLt64_*.dll')
else
  candidates=("$ROOT/lib64" "$ROOT"/targets/*/lib)
  runtime_globs=('libcudart.so.[0-9]*' 'libcublas.so.[0-9]*' 'libcublasLt.so.[0-9]*')
fi

LIBDIR=""
for d in "${candidates[@]}"; do
  if compgen -G "$d/${runtime_globs[0]}" >/dev/null; then LIBDIR="$d"; break; fi
done
[ -n "$LIBDIR" ] || {
  echo "stage-engine: no ${runtime_globs[0]} under $ROOT (looked in: ${candidates[*]})" >&2
  exit 1
}

runtime=0
for pat in "${runtime_globs[@]}"; do
  matched=0
  for src in "$LIBDIR"/$pat; do
    [ -e "$src" ] || [ -L "$src" ] || continue
    name="$(basename "$src")"
    cp -Pf "$src" "$DEST/$name"
    [ -L "$src" ] || chmod 644 "$DEST/$name"
    matched=$((matched + 1))
  done
  if [ "$matched" -eq 0 ]; then
    echo "stage-engine: $LIBDIR has no $pat; the CUDA module would not load without it" >&2
    exit 1
  fi
  runtime=$((runtime + matched))
done

# The name-pattern copy above is a guess about what the module wants; the ELF
# NEEDED list is the fact. A missing entry here is exactly the silent
# fall-to-Vulkan this step exists to prevent.
if [ "$LIBEXT" = "so" ] && command -v objdump >/dev/null 2>&1; then
  missing=""
  while read -r needed; do
    [ -e "$DEST/$needed" ] || missing="$missing $needed"
  done < <(objdump -p "$cuda_module" | awk '/NEEDED/ && $2 ~ /^libcu(dart|blas)/ {print $2}')
  if [ -n "$missing" ]; then
    echo "stage-engine: $(basename "$cuda_module") needs$missing, not staged from $LIBDIR" >&2
    exit 1
  fi
fi

echo "stage-engine: staged $runtime CUDA runtime libraries from $LIBDIR"

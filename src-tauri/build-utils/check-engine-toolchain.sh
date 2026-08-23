#!/usr/bin/env bash
# Fails fast when the toolchain on PATH cannot produce the requested variant.
# Without this, building `cuda12` on a CUDA 13 host silently yields a cuda13
# artifact under the cuda12 name -- which then crashes on the Pascal cards the
# cuda12 build exists to support.
#
# Takes the variant and the resolved cargo feature list, both decided by the
# Makefile. A script rather than a recipe so Windows checks the same things:
# make there runs recipes through cmd.exe, which has no `command -v`.
set -uo pipefail

VARIANT="${1:?usage: check-engine-toolchain.sh <variant> <features>}"
FEATURES="${2-}"

case "$VARIANT" in
cuda12 | cuda13)
  command -v nvcc >/dev/null 2>&1 || {
    echo "error: JAN_ENGINE_VARIANT=$VARIANT needs nvcc on PATH" >&2
    exit 1
  }
  want="${VARIANT#cuda}"
  got=$(nvcc --version | sed -n 's/.*release \([0-9]*\)\..*/\1/p' | head -1)
  if [ "$got" != "$want" ]; then
    echo "error: JAN_ENGINE_VARIANT=$VARIANT but nvcc reports CUDA $got" >&2
    echo "       point PATH/CUDA_HOME at a CUDA $want toolkit, or build the cuda$got variant" >&2
    exit 1
  fi
  echo "engine toolchain: CUDA $got matches $VARIANT"
  ;;
rocm)
  command -v hipcc >/dev/null 2>&1 || {
    echo "error: JAN_ENGINE_VARIANT=rocm needs hipcc on PATH (install ROCm)" >&2
    exit 1
  }
  echo "engine toolchain: hipcc found"
  ;;
esac

command -v cmake >/dev/null 2>&1 || {
  echo "error: building the engine needs cmake on PATH" >&2
  exit 1
}

if command -v ccache >/dev/null 2>&1; then
  max=$(ccache -s 2>/dev/null | awk -F': *' '/[Mm]ax cache size/ {print $2; exit}')
  echo "engine toolchain: ccache found${max:+ (max $max)}"
elif command -v sccache >/dev/null 2>&1; then
  echo "engine toolchain: sccache found"
else
  echo "warning: no ccache/sccache -- every engine rebuild recompiles from scratch." >&2
  echo "         A CUDA rebuild is tens of minutes without it, a couple with it:" >&2
  echo "           sudo apt install ccache && ccache -M 25G" >&2
  echo "         (25G because CUDA objects are large; the default 5G thrashes.)" >&2
fi

case ",$FEATURES," in
*,engine-vulkan,*)
  command -v glslc >/dev/null 2>&1 || command -v glslangValidator >/dev/null 2>&1 || {
    echo "error: the vulkan backend needs the Vulkan SDK (glslc) on PATH" >&2
    exit 1
  }
  echo "engine toolchain: Vulkan shader compiler found"
  ;;
esac

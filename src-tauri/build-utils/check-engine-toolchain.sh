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

# The variant is a `-` separated backend list, so each toolkit is asked for by
# the token that needs it rather than by the whole name.
TOKENS=" ${VARIANT//-/ } "
has_token() { case "$TOKENS" in *" $1 "*) return 0 ;; *) return 1 ;; esac; }

want=""
for token in $TOKENS; do
  case "$token" in
  cuda*) want="${token#cuda}" ;;
  esac
done
if [ -n "$want" ]; then
  command -v nvcc >/dev/null 2>&1 || {
    echo "error: JAN_ENGINE_VARIANT=$VARIANT needs nvcc on PATH" >&2
    exit 1
  }
  got=$(nvcc --version | sed -n 's/.*release \([0-9]*\)\..*/\1/p' | head -1)
  if [ "$got" != "$want" ]; then
    echo "error: JAN_ENGINE_VARIANT=$VARIANT but nvcc reports CUDA $got" >&2
    echo "       point PATH/CUDA_HOME at a CUDA $want toolkit, or build the cuda$got variant" >&2
    exit 1
  fi
  echo "engine toolchain: CUDA $got matches $VARIANT"
fi

if has_token hip || has_token rocm; then
  command -v hipcc >/dev/null 2>&1 || {
    echo "error: JAN_ENGINE_VARIANT=$VARIANT needs hipcc on PATH (install ROCm)" >&2
    exit 1
  }
  rocm="${ROCM_PATH:-${HIP_PATH:-/opt/rocm}}"
  [ -f "$rocm/include/rocwmma/rocwmma.hpp" ] || {
    echo "error: the hip backend builds with GGML_HIP_ROCWMMA_FATTN and needs rocwmma-dev" >&2
    echo "       (no $rocm/include/rocwmma/rocwmma.hpp; set ROCM_PATH if ROCm lives elsewhere)" >&2
    exit 1
  }
  echo "engine toolchain: hipcc and rocwmma found"
fi

command -v cmake >/dev/null 2>&1 || {
  echo "error: building the engine needs cmake on PATH" >&2
  exit 1
}

# Windows only, and both are upstream llama.cpp's own recipe for this build:
# Ninja because ggml's vulkan-shaders-gen ExternalProject cannot identify a
# compiler when nested inside MSBuild, and clang because ggml's per-CPU-variant
# flags (-mavxvnni and friends) live in its GNU-driver branch.
case "$(uname -s)" in
MINGW* | MSYS* | CYGWIN*)
  command -v ninja >/dev/null 2>&1 || {
    echo "error: the engine build needs ninja on PATH on Windows" >&2
    echo "       (the Visual Studio generator cannot build vulkan-shaders-gen)" >&2
    exit 1
  }
  command -v clang >/dev/null 2>&1 || {
    echo "error: the engine build needs clang on PATH on Windows (install LLVM)" >&2
    exit 1
  }
  if ! command -v cl >/dev/null 2>&1; then
    # An ARM64 build never puts cl on PATH: the one nvcc needs is the arm64
    # cross, which build.rs passes by full path as CMAKE_CUDA_HOST_COMPILER.
    # So there it is VCToolsInstallDir that has to be right, not PATH; probed
    # the same way build.rs probes it, since arm64 is hosted from either.
    #
    # rustc for the arch, not uname: Git for Windows on an ARM64 runner is the
    # x86-64 build under emulation and reports x86_64. Backslashes to forward
    # slashes because MSYS resolves a C:/... path and cygpath is not on every
    # Git for Windows install.
    host_cl=""
    case "$(rustc -vV 2>/dev/null | sed -n 's/^host: //p')" in
    aarch64-*)
      root=$(printf '%s' "${VCToolsInstallDir:-}" | tr '\\' '/')
      for h in Hostarm64 Hostx64; do
        [ -n "$root" ] && [ -f "$root/bin/$h/arm64/cl.exe" ] || continue
        host_cl="$root/bin/$h/arm64/cl.exe"
        break
      done
      ;;
    esac
    if [ -n "$host_cl" ]; then
      echo "engine toolchain: nvcc host compiler $host_cl"
    elif [ -n "$want" ]; then
      echo "error: nvcc needs cl on PATH on Windows; run from a Visual Studio developer prompt" >&2
      echo "       (on ARM64, set VCToolsInstallDir to an MSVC toolset with bin/Host*/arm64/cl.exe;" >&2
      echo "        VCToolsInstallDir='${VCToolsInstallDir:-}')" >&2
      exit 1
    else
      echo "warning: cl is not on PATH; run from a Visual Studio developer prompt" >&2
      echo "         if the build cannot find the MSVC headers and libraries." >&2
    fi
  fi
  echo "engine toolchain: ninja and clang found"
  ;;
esac

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

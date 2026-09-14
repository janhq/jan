#!/usr/bin/env bash
# S3 cache of llama.cpp's cmake outputs, in the JAN_LLAMA_PREBUILT_DIR layout
# build.rs links against: lib/ (stage 2 archives plus ggml-prefix/lib), an
# empty include/ and bin/ (ggml-prefix/bin). Any failure here means no
# prebuilt, which is exactly the full cmake build.
#
#   key <features>  print the object key for this job's native-build inputs,
#                   exit 1 if not cacheable. Run it as `make engine-prebuilt-key`.
#   restore         fetch + verify it, then export JAN_LLAMA_PREBUILT_DIR
#                   (needs BUCKET + AWS env)
#   save            pack this run's cmake outputs and upload them as $KEY
#                   (needs BUCKET, KEY + AWS env)
#
# Run from the repo root, in the job env of `make build`.
set -euo pipefail

EPOCH=1 # hashed into the key with the rest of this file's code; bump to force every leg to rebuild
P=src-tauri/plugins/tauri-plugin-llamacpp

nocr() { tr -d '\r'; }
unixpath() { if command -v cygpath >/dev/null 2>&1; then cygpath -u "$1"; else printf '%s\n' "$1"; fi; }
# A shell script minus its comment and blank lines, so rewording one is not a rebuild
script_code() { nocr < "$1" | sed '/^[[:space:]]*\(#.*\)\{0,1\}$/d'; }

# build.rs's ARCHIVES, read rather than copied so the two cannot drift, minus
# jan_llama_shim, which cc rebuilds on every build
archives() {
  nocr < "$P/build.rs" | sed -n '/const ARCHIVES: /,/];/s/^ *"\([^"]*\)",*$/\1/p' | grep -vx jan_llama_shim
}

# Everything the prebuilt link and stage-engine.sh need. build.rs itself only
# checks that lib/ and include/ exist, so a gap would surface as a link error.
is_complete() {
  local a list
  list=$(archives) || return 1
  for a in $list ggml ggml-base; do # plus build.rs SHARED_LIBS; -e follows the .so symlink chain
    [ -e "$1/lib/lib$a.a" ] || [ -e "$1/lib/$a.lib" ] || [ -e "$1/lib/lib$a.so" ] || return 1
  done
  [ -d "$1/include" ] && ls "$1"/bin/*ggml-cpu* >/dev/null 2>&1
}

case "${1:-}" in
key)
  features=${2:?usage: make engine-prebuilt-key}
  [ -z "${JAN_LLAMA_CPP_DIR:-}" ] || exit 1 # a local checkout is not the pinned source
  # ROCm's version is not keyed, and no desktop build ships the hip backend
  [[ ",$features," != *,engine-hip,* ]] || exit 1
  rs=$(nocr < "$P/build.rs")
  tag=$(sed -n 's/^pub const LLAMA_CPP_TAG: &str = "\(.*\)";$/\1/p' <<<"$rs")
  triple=$(rustc -vV | nocr | sed -n 's/^host: //p') # build-engine passes no --target
  [ -n "$tag" ] && [ -n "$triple" ] || exit 1

  t="$triple $features"
  for v in JAN_ENGINE_CUDA_ARCHS CC CXX CFLAGS CXXFLAGS LDFLAGS CUDAFLAGS CUDAHOSTCXX \
           CMAKE_GENERATOR CMAKE_TOOLCHAIN_FILE; do
    t+=" $v=${!v:-}"
  done
  if [[ ",$features," == *,engine-cuda,* ]]; then
    # Full version: it picks the default CUDA arch list, and the runtime
    # stage-engine.sh copies from this toolkit must be at least as new
    v=$(nvcc --version | nocr | sed -n 's/.*release [0-9.]*, \(V[0-9.]*\).*/\1/p')
    [ -n "$v" ] || exit 1
    t+=" nvcc=$v"
  fi
  if [[ ",$features," == *,engine-vulkan,* ]]; then
    # glslc decides which GGML_VULKAN_*_GLSLC_SUPPORT shader sets get compiled
    v=$(glslc --version | nocr | tr '\n' ' ')
    [ -n "$v" ] || exit 1
    t+=" glslc=$v"
  fi
  case "$triple" in
  *-linux-gnu)
    # Archives from a newer gcc need its newer libstdc++/glibc at link time
    v=$(${CXX:-c++} -dumpfullversion)
    [ -n "$v" ] || exit 1
    t+=" gcc=$v $(getconf GNU_LIBC_VERSION)" ;;
  *-windows-msvc)
    # ponytail: needs a VS dev env (msvc-dev-cmd on x64 cuda, exported by the arm64 template);
    # a vulkan-only Windows build has none and won't cache. Add a vswhere fallback if that matters.
    v=${VCToolsVersion:-$(printf %s "${VCToolsInstallDir:-}" | nocr | tr '\\' / | sed 's#/*$##; s#.*/##')}
    c=$(clang --version | nocr | sed -n '1s/.*version \([0-9]*\).*/\1/p')
    [ -n "$v" ] && [ -n "$c" ] || exit 1
    # major.minor: an older link.exe must not meet archives from a newer toolset
    t+=" msvc=${v%.*} clang=$c" ;;
  *)
    exit 1 ;; # macOS: ~3 min engine with ccache, not worth caching
  esac
  echo "engine-prebuilt: $t" >&2

  # One checked read per input: a slice that comes back empty, e.g. after
  # `mod engine` is renamed, must make this uncacheable, not drop out of the key
  pin=$(grep '^pub const LLAMA_CPP_' <<<"$rs" | grep -v '_VERSION:')           # the pin, not its label
  eng=$(awk '/^mod engine [{]/{m=1} m && NF && !/^[[:space:]]*\/\//' <<<"$rs") # cmake logic, minus comments
  feat=$(nocr < "$P/Cargo.toml" | sed -n '/^\[features\]/,/^\[/p')             # not CI's package.version stamp
  fetch=$(script_code src-tauri/build-utils/fetch-engine-source.sh)            # how that pin becomes a tree
  self=$(script_code "$0")                                                     # this script, incl. EPOCH
  [ -n "$pin" ] && [ -n "$eng" ] && [ -n "$feat" ] && [ -n "$fetch" ] && [ -n "$self" ] || exit 1
  h=$(printf '%s\n' "$pin" "$eng" "$feat" "$fetch" "$self" "$t" | sha256sum | cut -c1-32)
  echo "ci-cache/llama-prebuilt/$triple/$tag-${features//,/+}-$h.tar.gz" ;;

restore)
  [ -n "${BUCKET:-}" ] || exit 0 # no credentials in this context
  k=$(make -s --no-print-directory engine-prebuilt-key) || {
    echo "::notice::engine-prebuilt: not cacheable here"; exit 0; }
  echo "key=$k" >> "$GITHUB_OUTPUT"
  d="$RUNNER_TEMP/llama-prebuilt"
  # D:/a/_temp/... is understood by bash, tar -C and build.rs's PathBuf alike
  if command -v cygpath >/dev/null 2>&1; then d=$(cygpath -m "$d"); fi
  rm -rf "$d" && mkdir -p "$d"
  # Streamed: no second copy on disk, and GNU tar never parses "D:" in -f as a remote host
  if aws s3 cp "s3://$BUCKET/$k" - | tar -xzf - -C "$d" && is_complete "$d"; then
    echo "JAN_LLAMA_PREBUILT_DIR=$d" >> "$GITHUB_ENV"
    echo "hit=true" >> "$GITHUB_OUTPUT"
    echo "::notice::engine-prebuilt: hit $k"
  else
    rm -rf "$d"
    echo "::notice::engine-prebuilt: miss $k"
  fi ;;

save)
  [ -n "${BUCKET:-}" ] && [ -n "${KEY:-}" ] || exit 0
  exe=
  case "$(uname -s)" in MINGW*|MSYS*|CYGWIN*) exe=.exe ;; esac
  # A non-empty staged worker proves both cmake stages built and linked in this run
  [ -s "src-tauri/resources/bin/jan-llama-worker$exe" ] || {
    echo "::warning::engine-prebuilt: engine not built this run; not saving"; exit 0; }
  marker=$(ls -t "${CARGO_TARGET_DIR:-$P/target}"/release/build/tauri-plugin-llamacpp-*/out/engine-build-root.txt | head -1)
  root=$(unixpath "$(nocr < "$marker" | tr -d '\n')") # relocated out of OUT_DIR on Windows
  o=$(unixpath "$RUNNER_TEMP")/llama-prebuilt-pack
  rm -rf "$o" && mkdir -p "$o/lib" "$o/include" "$o/bin"
  # `-exec ... +` rather than `\;`, so a failed copy fails the save instead of being ignored
  for a in $(archives); do # Ninja Multi-Config puts the Windows ones under Release/
    find "$root/llama-build" -maxdepth 4 \( -name "lib$a.a" -o -name "$a.lib" \) -exec cp -t "$o/lib/" {} +
  done
  # soname symlink chains (Linux) or the ggml.lib/ggml-base.lib import libs (Windows); not lib/cmake
  find "$root/ggml-prefix/lib" -maxdepth 1 ! -type d -exec cp -P -t "$o/lib/" {} +
  # Verbatim: the backend modules, plus ggml.dll and ggml-base.dll on Windows
  cp -P "$root/ggml-prefix/bin/"* "$o/bin/"
  is_complete "$o" || { echo "::warning::engine-prebuilt: incomplete cmake outputs; not saving"; exit 0; }
  tar -czf - -C "$o" lib include bin | aws s3 cp --no-progress - "s3://$BUCKET/$KEY"
  echo "::notice::engine-prebuilt: saved $KEY" ;;

*)
  echo "usage: $0 key <features>|restore|save" >&2
  exit 2 ;;
esac

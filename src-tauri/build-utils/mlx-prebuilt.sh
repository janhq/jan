#!/usr/bin/env bash
# S3 cache of the mlx-server build: the executable plus mlx-swift's Metal bundle,
# as xcodebuild leaves them (unsigned), which `make build-mlx-server` then stages
# and signs from JAN_MLX_PREBUILT_DIR instead of building. Any failure here means
# no prebuilt, which is exactly the xcodebuild build.
#
#   restore  resolve the Swift packages, fetch + verify the object for exactly
#            that resolution, then export JAN_MLX_PREBUILT_DIR (needs BUCKET + AWS env)
#   save     pack this run's xcodebuild products and upload them as $KEY
#            (needs BUCKET, KEY + AWS env)
#
# macOS only. Run from the repo root.
set -euo pipefail

EPOCH=1 # hashed into the key with the rest of this file's code; bump to force a rebuild

# The two things the Makefile copies out of the build products
is_complete() {
  [ -x "$1/mlx-server" ] && [ -n "$(find "$1/mlx-swift_Cmlx.bundle" -name default.metallib -print -quit 2>/dev/null)" ]
}

case "${1:-}" in
restore)
  [ -n "${BUCKET:-}" ] || exit 0 # no credentials in this context
  # Package.swift takes version ranges and no Package.resolved is committed, so
  # what gets built is whatever resolves today: key on that, not the manifest.
  # xcodebuild keeps the checkouts it fetches here, so a miss fetches them once.
  if ! out=$(cd mlx-server && xcodebuild -resolvePackageDependencies -scheme mlx-server 2>&1); then
    printf '%s\n' "$out" | tail -20
    echo "::notice::mlx-prebuilt: package resolution failed; not cacheable here"
    exit 0
  fi
  resolved=$(printf '%s\n' "$out" | sed -n '/^Resolved source packages:/,/^[[:space:]]*$/p' | grep ' @ ' | LC_ALL=C sort || true)
  [ -n "$resolved" ] || resolved=$(cat mlx-server/Package.resolved \
    mlx-server/.swiftpm/xcode/package.xcworkspace/xcshareddata/swiftpm/Package.resolved 2>/dev/null || true)
  xcode=$(xcodebuild -version | tr '\n' ' ')
  metal=$(xcrun metal --version 2>/dev/null | head -1 || true) # when readable; the toolchain ships apart from Xcode
  flags=$(grep -F 'xcodebuild build' Makefile || true)
  src=$(find mlx-server/Package.swift mlx-server/Sources -type f | LC_ALL=C sort | xargs shasum -a 256)
  self=$(sed '/^[[:space:]]*\(#.*\)\{0,1\}$/d' "$0")
  if [ -z "$resolved" ] || [ -z "$flags" ] || [ -z "$src" ]; then
    echo "::notice::mlx-prebuilt: a key input came back empty; not cacheable here"
    exit 0
  fi
  echo "mlx-prebuilt: $(uname -m) $xcode metal=$metal"
  printf '%s\n' "$resolved"
  h=$(printf '%s\n' "$(uname -m)" "$xcode" "$metal" "$resolved" "$flags" "$src" "$self" | shasum -a 256 | cut -c1-32)
  k="ci-cache/mlx-server/$(uname -m)-$h.tar.gz"
  echo "key=$k" >> "$GITHUB_OUTPUT"
  d="$RUNNER_TEMP/mlx-prebuilt"
  rm -rf "$d" && mkdir -p "$d"
  if aws s3 cp "s3://$BUCKET/$k" - | tar -xzf - -C "$d" && is_complete "$d"; then
    echo "JAN_MLX_PREBUILT_DIR=$d" >> "$GITHUB_ENV"
    echo "hit=true" >> "$GITHUB_OUTPUT"
    echo "::notice::mlx-prebuilt: hit $k"
  else
    rm -rf "$d"
    echo "::notice::mlx-prebuilt: miss $k"
  fi ;;

save)
  [ -n "${BUCKET:-}" ] && [ -n "${KEY:-}" ] || exit 0
  # A staged binary proves xcodebuild built it in this run
  [ -x src-tauri/resources/bin/mlx-server ] || {
    echo "::warning::mlx-prebuilt: mlx-server not built this run; not saving"; exit 0; }
  p=$(find ~/Library/Developer/Xcode/DerivedData/mlx-server-*/Build/Products/Release -maxdepth 0 2>/dev/null | head -1 || true)
  [ -n "$p" ] && is_complete "$p" || {
    echo "::warning::mlx-prebuilt: incomplete xcodebuild products; not saving"; exit 0; }
  tar -czf - -C "$p" mlx-server mlx-swift_Cmlx.bundle | aws s3 cp --no-progress - "s3://$BUCKET/$KEY"
  echo "::notice::mlx-prebuilt: saved $KEY" ;;

*)
  echo "usage: $0 restore|save" >&2
  exit 2 ;;
esac

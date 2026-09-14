#!/usr/bin/env bash
# Routes the rest of this job's Rust compiles through sccache, cached in S3
# under ci-cache/sccache/, so a dependency crate compiles once per version and
# flags instead of once per run. Its keys hash every compiler input, which is
# what makes one prefix safe to share across platforms and branches.
#
# Needs BUCKET, REGION, the AWS credentials, and WRITE=true only where the
# cache may be written. Any failure leaves RUSTC_WRAPPER unset, which is a plain
# uncached build. Run from the repo root, before the step that builds; that step
# needs the AWS credentials too, in case the server has to be started again.
set -euo pipefail

VERSION=v0.17.0
[ -n "${BUCKET:-}" ] || exit 0 # no credentials in this context

# Pinned by hash: this binary runs every Rust compile of a signed release.
case "$RUNNER_OS-$RUNNER_ARCH" in
Linux-X64)     triple=x86_64-unknown-linux-musl sha=67c4a96dd237c1f518f6b36083f270f9976d516f1e57fce891755ea782e50006 ;;
macOS-ARM64)   triple=aarch64-apple-darwin      sha=0c560bfba31aef5bdfb4fb3d2677f6e61d71c5c00952f2a83344f47aa31f00f1 ;;
macOS-X64)     triple=x86_64-apple-darwin       sha=c2144cafbfe3d22e34ae637f9974ce53613543ac19477fdb287df22ea3668261 ;;
Windows-X64)   triple=x86_64-pc-windows-msvc    sha=caf1932d76a909c909b7a2e41443cdfe3c79a49a380da1a22fa422e1d00d3ca7 ;;
Windows-ARM64) triple=aarch64-pc-windows-msvc   sha=f1bec6836a764f5f0a01ae3b5d47d1778a6b80171f9f49722e246cdff27a9f3b ;;
*) echo "::notice::sccache: no pinned build for $RUNNER_OS-$RUNNER_ARCH"; exit 0 ;;
esac

name=sccache-$VERSION-$triple
# A POSIX path for tar, which would read "D:" in -f as a remote host
dir=$(if command -v cygpath >/dev/null 2>&1; then cygpath -u "$RUNNER_TEMP"; else printf '%s' "$RUNNER_TEMP"; fi)/sccache
rm -rf "$dir" && mkdir -p "$dir"
curl -fsSL --retry 5 --retry-all-errors -o "$dir/$name.tar.gz" \
  "https://github.com/mozilla/sccache/releases/download/$VERSION/$name.tar.gz"
got=$( (sha256sum "$dir/$name.tar.gz" 2>/dev/null || shasum -a 256 "$dir/$name.tar.gz") | cut -d' ' -f1)
[ "$got" = "$sha" ] || { echo "::warning::sccache: $name.tar.gz hashes to $got, not $sha"; exit 1; }
tar -xzf "$dir/$name.tar.gz" -C "$dir"
exe=$dir/$name/sccache
[ -f "$exe.exe" ] && exe=$exe.exe
"$exe" --version
mode=READ_ONLY
[ "${WRITE:-}" != true ] || mode=READ_WRITE
vars="SCCACHE_BUCKET=$BUCKET
SCCACHE_REGION=${REGION:-}
SCCACHE_S3_KEY_PREFIX=ci-cache/sccache/
SCCACHE_S3_RW_MODE=$mode
SCCACHE_IDLE_TIMEOUT=0
SCCACHE_IGNORE_SERVER_IO_ERROR=1"
# The server checks the storage when it starts and refuses to run if S3 fails
# that check, and then every rustc that needs it fails the build. So start it
# here, where a failure only means no wrapper. IDLE_TIMEOUT=0 keeps it, and its
# stats, for the rest of the job; IGNORE_SERVER_IO_ERROR compiles locally if it
# stops answering mid-build.
while IFS= read -r v; do export "${v?}"; done <<<"$vars"
"$exe" --start-server || { echo "::warning::sccache: the server did not start; building without it"; exit 1; }
# Deliberately not on PATH: ggml's cmake takes any sccache it finds there as its
# compiler launcher, which would change the cold engine build.
if command -v cygpath >/dev/null 2>&1; then exe=$(cygpath -m "$exe"); fi
printf 'RUSTC_WRAPPER=%s\n%s\n' "$exe" "$vars" >> "$GITHUB_ENV"
echo "::notice::sccache: $VERSION, $mode"

#!/usr/bin/env bash
set -euo pipefail

# wrapper script to pin linuxdeploy version and inject environment variables into the 
# build process. While yarn supports injecting environment vairables via env files,
# this applies to all yarn scripts. Using a wrapper allows granular control over
# when environment variables are injected, and avoids tainting the system .cache

# avoid redownloading corepack if possible
export COREPACK_HOME=${COREPACK_HOME:-${XDG_CACHE_HOME:-$HOME/.cache}/node/corepack}
# move cache home to <project root>/.cache
export XDG_CACHE_HOME=${PWD}/.cache

LINUXDEPLOY_VER="1-alpha-20250213-2"
LINUXDEPLOY="$XDG_CACHE_HOME/tauri/linuxdeploy-$LINUXDEPLOY_VER-x86_64.AppImage"
SYMLINK="$XDG_CACHE_HOME/tauri/linuxdeploy-x86_64.AppImage"

mkdir -p "$XDG_CACHE_HOME/tauri"

if [ ! -f "$LINUXDEPLOY" ]; then
  GLOB_PATTERN="$XDG_CACHE_HOME/tauri/linuxdeploy-*-x86_64.AppImage"
  rm -f $GLOB_PATTERN
  wget "https://github.com/linuxdeploy/linuxdeploy/releases/download/$LINUXDEPLOY_VER/linuxdeploy-x86_64.AppImage" -O "$LINUXDEPLOY"
  chmod a+x "$LINUXDEPLOY"
fi

# A wrapper rather than a symlink: tauri discards linuxdeploy's output, so a
# failure reaches CI as `failed to run linuxdeploy` and nothing else. The copy
# is what the build job uploads when it fails.
LINUXDEPLOY_LOG="$XDG_CACHE_HOME/tauri/linuxdeploy.log"
rm -f "$SYMLINK" "$LINUXDEPLOY_LOG"
cat > "$SYMLINK" <<EOF
#!/usr/bin/env bash
set -o pipefail
"$LINUXDEPLOY" "\$@" 2>&1 | tee -a "$LINUXDEPLOY_LOG"
exit \${PIPESTATUS[0]}
EOF
chmod +x "$SYMLINK"

"$@"
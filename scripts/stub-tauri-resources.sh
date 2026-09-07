#!/usr/bin/env bash
# The Tauri build script validates resources, externalBin, icons and
# frontendDist exist. Create stubs so a compile-only run succeeds in CI, where
# none of them are built.
set -euo pipefail

TRIPLE=$(rustc -vV | awk '/^host:/ { print $2 }')
mkdir -p src-tauri/resources/bin src-tauri/resources/pre-install src-tauri/icons web-app/dist
[ -f src-tauri/resources/LICENSE ] || touch src-tauri/resources/LICENSE
[ -f web-app/dist/index.html ] || touch web-app/dist/index.html
[ "$(ls -A src-tauri/resources/pre-install 2>/dev/null)" ] || touch src-tauri/resources/pre-install/.gitkeep
for bin in uv bun; do
  stub="src-tauri/resources/bin/${bin}-${TRIPLE}"
  [ -f "$stub" ] || touch "$stub"
done
# The engine worker and the ggml runtime beside it. `libggml*` is a glob in the
# bundle config, and a glob that matches nothing is an error (GlobPathNotFound),
# not an empty set -- so one stub library is required, not optional. The CLI is
# `jan-cli` on some branches and `jan` on others; the Tauri config only asks for
# one, and stubbing the other costs nothing.
case "$(uname -s)" in
  Darwin)
    EXE=""; LIB="libggml-base.dylib"
    # macOS also bundles the MLX server and the resource bundle beside it.
    [ -f src-tauri/resources/bin/mlx-server ] || touch src-tauri/resources/bin/mlx-server
    [ -e src-tauri/resources/bin/mlx-swift_Cmlx.bundle ] || mkdir -p src-tauri/resources/bin/mlx-swift_Cmlx.bundle
    ;;
  MINGW* | MSYS* | CYGWIN*) EXE=".exe"; LIB="ggml-base.dll" ;;
  *) EXE=""; LIB="libggml-base.so" ;;
esac
for bin in jan jan-cli jan-llama-worker; do
  [ -f "src-tauri/resources/bin/${bin}${EXE}" ] || touch "src-tauri/resources/bin/${bin}${EXE}"
done
ls src-tauri/resources/bin/*ggml*."${LIB##*.}"* >/dev/null 2>&1 || touch "src-tauri/resources/bin/$LIB"
# Icons are gitignored; generate_context!() requires them at compile time
for icon in 32x32.png 128x128.png 128x128@2x.png icon.icns icon.ico; do
  [ -f "src-tauri/icons/$icon" ] || cp src-tauri/icons/icon.png "src-tauri/icons/$icon"
done

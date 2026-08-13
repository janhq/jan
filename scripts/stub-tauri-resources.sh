#!/usr/bin/env bash
# The Tauri build script validates resources, externalBin, icons and
# frontendDist exist. Create stubs so a compile-only run succeeds in CI, where
# none of them are built.
set -euo pipefail

TRIPLE=$(rustc -vV | awk '/^host:/ { print $2 }')
mkdir -p src-tauri/resources/bin src-tauri/resources/pre-install src-tauri/icons web-app/dist
[ -f src-tauri/resources/LICENSE ] || touch src-tauri/resources/LICENSE
# The bundled CLI is `jan-cli` on some branches and `jan` on others; the Tauri
# config only asks for one, and stubbing the other costs nothing.
for cli in jan jan-cli; do
  [ -f "src-tauri/resources/bin/$cli" ] || touch "src-tauri/resources/bin/$cli"
done
[ -f web-app/dist/index.html ] || touch web-app/dist/index.html
[ "$(ls -A src-tauri/resources/pre-install 2>/dev/null)" ] || touch src-tauri/resources/pre-install/.gitkeep
for bin in uv bun; do
  stub="src-tauri/resources/bin/${bin}-${TRIPLE}"
  [ -f "$stub" ] || touch "$stub"
done
# Icons are gitignored; generate_context!() requires them at compile time
for icon in 32x32.png 128x128.png 128x128@2x.png icon.icns icon.ico; do
  [ -f "src-tauri/icons/$icon" ] || cp src-tauri/icons/icon.png "src-tauri/icons/$icon"
done

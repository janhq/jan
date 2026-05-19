#!/usr/bin/env bash
#* Подпись Mach-O в resources/bin до bundle: иначе копия в Contents/Resources/… не подписана
#* и notarytool отклоняет архив («The binary is not signed» для jan-cli и т.д.).
#? Если APPLE_SIGNING_IDENTITY не задан — выходим (локальные сборки без подписи).
set -euo pipefail
if [[ "$(uname -s)" != "Darwin" ]]; then
  exit 0
fi
IDENTITY="${APPLE_SIGNING_IDENTITY:-}"
if [[ -z "$IDENTITY" ]]; then
  exit 0
fi
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENT="$HERE/Entitlements.plist"
BIN="$HERE/resources/bin"
[[ -d "$BIN" ]] || exit 0
[[ -f "$ENT" ]] || { echo "sign-macos-resource-binaries: нет $ENT"; exit 1; }

#? Подписываем только исполняемые Mach-O (не .bundle, не произвольные файлы).
sign_if_macho() {
  local f="$1"
  [[ -f "$f" && -x "$f" ]] || return 0
  if file "$f" | grep -q 'Mach-O'; then
    echo "codesign (resources): $f"
    codesign --force --sign "$IDENTITY" --options runtime --timestamp --entitlements "$ENT" "$f"
  fi
}

for name in jan-cli mlx-server foundation-models-server; do
  sign_if_macho "$BIN/$name"
done

#? llamacpp-backend Mach-O binaries (turboquant fork + upstream ggml-org)
for sub in llamacpp-backend llamacpp-backend-upstream; do
  LLAMA_BIN="$HERE/resources/$sub/build/bin"
  if [[ -d "$LLAMA_BIN" ]]; then
    for f in "$LLAMA_BIN"/*; do
      sign_if_macho "$f"
    done
  fi
done

#? sqlite-vec и др. — при появлении ошибок notary добавить сюда или расширить цикл.

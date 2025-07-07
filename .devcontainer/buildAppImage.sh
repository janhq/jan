#!/usr/bin/env bash

make clean

# To reproduce https://github.com/menloresearch/jan/pull/5463
TAURI_TOOLKIT_PATH="${XDG_CACHE_HOME:-$HOME/.cache}/tauri"
mkdir -p "$TAURI_TOOLKIT_PATH"
wget https://github.com/linuxdeploy/linuxdeploy/releases/download/1-alpha-20250213-2/linuxdeploy-x86_64.AppImage -O "$TAURI_TOOLKIT_PATH/linuxdeploy-x86_64.AppImage"
chmod +x "$TAURI_TOOLKIT_PATH/linuxdeploy-x86_64.AppImage"

jq '.bundle.resources = ["resources/pre-install/**/*"] | .bundle.externalBin = ["resources/bin/uv"]' ./src-tauri/tauri.conf.json > /tmp/tauri.conf.json
mv /tmp/tauri.conf.json ./src-tauri/tauri.conf.json         

make build-tauri

cp ./src-tauri/resources/bin/bun ./src-tauri/target/release/bundle/appimage/Jan.AppDir/usr/bin/bun
mkdir -p ./src-tauri/target/release/bundle/appimage/Jan.AppDir/usr/lib/Jan/binaries/engines
cp -f ./src-tauri/binaries/deps/*.so* ./src-tauri/target/release/bundle/appimage/Jan.AppDir/usr/lib/Jan/binaries/
cp -f ./src-tauri/binaries/*.so* ./src-tauri/target/release/bundle/appimage/Jan.AppDir/usr/lib/Jan/binaries/
cp -rf ./src-tauri/binaries/engines ./src-tauri/target/release/bundle/appimage/Jan.AppDir/usr/lib/Jan/binaries/
APP_IMAGE=./src-tauri/target/release/bundle/appimage/$(ls ./src-tauri/target/release/bundle/appimage/ | grep AppImage | head -1)
echo $APP_IMAGE
rm -f $APP_IMAGE
/opt/bin/appimagetool ./src-tauri/target/release/bundle/appimage/Jan.AppDir $APP_IMAGE
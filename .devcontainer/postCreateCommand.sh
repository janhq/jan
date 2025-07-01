#!/usr/bin/env bash

# install tauri prerequisites + xdg-utils for xdg-open + libfuse2 for using appimagekit

sudo apt update
sudo apt install -yqq libwebkit2gtk-4.1-dev \
    build-essential \
    curl \
    wget \
    file \
    libxdo-dev \
    libssl-dev \
    libayatana-appindicator3-dev \
    librsvg2-dev \
    xdg-utils \
    libfuse2

sudo mkdir -p /opt/bin
sudo wget https://github.com/AppImage/AppImageKit/releases/download/continuous/appimagetool-x86_64.AppImage -O /opt/bin/appimagetool
sudo chmod +x /opt/bin/appimagetool
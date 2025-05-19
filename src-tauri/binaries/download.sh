#!/bin/bash

download() {
  URL="$1"
  EXTRA_ARGS="${@:3}"
  OUTPUT_DIR="${EXTRA_ARGS[${#EXTRA_ARGS[@]} -1]}"

  mkdir -p "$OUTPUT_DIR"

  echo "Downloading $URL to $OUTPUT_DIR using curl..."
  curl -L "$URL" -o "$OUTPUT_DIR/$(basename "$URL")"
  tar -xzf "$OUTPUT_DIR/$(basename "$URL")" -C "$OUTPUT_DIR" --strip-components $2
  rm "$OUTPUT_DIR/$(basename "$URL")"
}

# Read CORTEX_VERSION
ENGINE_VERSION=b5509
ENGINE_DOWNLOAD_URL=https://github.com/menloresearch/llama.cpp/releases/download/${ENGINE_VERSION}/llama-${ENGINE_VERSION}-bin
CUDA_DOWNLOAD_URL=https://github.com/menloresearch/llama.cpp/releases/download/${ENGINE_VERSION}
BIN_PATH=./
SHARED_PATH="."
# Detect platform
OS_TYPE=$(uname)

if ls "${SHARED_PATH}/engines/llama.cpp/linux-noavx-x64/${ENGINE_VERSION}" 1> /dev/null 2>&1; then
    echo "llama-server file with prefix already exists. Exiting."
    exit 0
fi

if [ "$OS_TYPE" == "Linux" ]; then
    # Linux downloads

    # Download engines for Linux
    download "${ENGINE_DOWNLOAD_URL}-linux-avx2-x64.tar.gz" 2 "${SHARED_PATH}/engines/llama.cpp/linux-avx2-x64/${ENGINE_VERSION}"

elif [ "$OS_TYPE" == "Darwin" ]; then
    # macOS downloads

    # Download engines for macOS
    download "${ENGINE_DOWNLOAD_URL}-macos-arm64.tar.gz" 2 "${SHARED_PATH}/engines/llama.cpp/macos-arm64/${ENGINE_VERSION}"
    download "${ENGINE_DOWNLOAD_URL}-macos-x64.tar.gz" 2 "${SHARED_PATH}/engines/llama.cpp/macos-x64/${ENGINE_VERSION}"


else
    echo "Unsupported operating system: $OS_TYPE"
    exit 1
fi

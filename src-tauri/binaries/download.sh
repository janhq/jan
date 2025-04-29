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
CORTEX_VERSION=1.0.13-rc5
ENGINE_VERSION=b5058
CORTEX_RELEASE_URL="https://github.com/menloresearch/cortex.cpp/releases/download"
ENGINE_DOWNLOAD_URL=https://github.com/menloresearch/llama.cpp/releases/download/${ENGINE_VERSION}/llama-${ENGINE_VERSION}-bin
CUDA_DOWNLOAD_URL="https://github.com/menloresearch/cortex.llamacpp/releases/download/v${ENGINE_VERSION}"
BIN_PATH=./
SHARED_PATH="."
# Detect platform
OS_TYPE=$(uname)

if ls ./cortex-server* 1> /dev/null 2>&1; then
    echo "cortex-server file with prefix already exists. Exiting."
    exit 0
fi

if [ "$OS_TYPE" == "Linux" ]; then
    # Linux downloads
    download "${CORTEX_RELEASE_URL}/v${CORTEX_VERSION}/cortex-${CORTEX_VERSION}-linux-amd64.tar.gz" 1 "${BIN_PATH}"
    mv .cortex-server-beta ./cortex-server
    rm -rf ./cortex
    rm -rf ./cortex-beta
    chmod +x "./cortex-server"

    # Download engines for Linux
    download "${ENGINE_DOWNLOAD_URL}-linux-amd64-noavx.tar.gz" 2 "${SHARED_PATH}/engines/cortex.llamacpp/linux-amd64-noavx/v${ENGINE_VERSION}"
    download "${ENGINE_DOWNLOAD_URL}-linux-amd64-avx.tar.gz" 2 "${SHARED_PATH}/engines/cortex.llamacpp/linux-amd64-avx/v${ENGINE_VERSION}"
    download "${ENGINE_DOWNLOAD_URL}-linux-amd64-avx2.tar.gz" 2 "${SHARED_PATH}/engines/cortex.llamacpp/linux-amd64-avx2/v${ENGINE_VERSION}"
    download "${ENGINE_DOWNLOAD_URL}-linux-amd64-avx512.tar.gz" 2 "${SHARED_PATH}/engines/cortex.llamacpp/linux-amd64-avx512/v${ENGINE_VERSION}"
    download "${ENGINE_DOWNLOAD_URL}-linux-amd64-avx2-cuda-12-0.tar.gz" 2 "${SHARED_PATH}/engines/cortex.llamacpp/linux-amd64-avx2-cuda-12-0/v${ENGINE_VERSION}"
    download "${ENGINE_DOWNLOAD_URL}-linux-amd64-avx2-cuda-11-7.tar.gz" 2 "${SHARED_PATH}/engines/cortex.llamacpp/linux-amd64-avx2-cuda-11-7/v${ENGINE_VERSION}"
    download "${ENGINE_DOWNLOAD_URL}-linux-amd64-noavx-cuda-12-0.tar.gz" 2 "${SHARED_PATH}/engines/cortex.llamacpp/linux-amd64-noavx-cuda-12-0/v${ENGINE_VERSION}"
    download "${ENGINE_DOWNLOAD_URL}-linux-amd64-noavx-cuda-11-7.tar.gz" 2 "${SHARED_PATH}/engines/cortex.llamacpp/linux-amd64-noavx-cuda-11-7/v${ENGINE_VERSION}"
    download "${ENGINE_DOWNLOAD_URL}-linux-amd64-vulkan.tar.gz" 2 "${SHARED_PATH}/engines/cortex.llamacpp/linux-amd64-vulkan/v${ENGINE_VERSION}"
    download "${CUDA_DOWNLOAD_URL}/cuda-12-0-linux-amd64.tar.gz" 1 "${BIN_PATH}"
    download "${CUDA_DOWNLOAD_URL}/cuda-11-7-linux-amd64.tar.gz" 1 "${BIN_PATH}"

elif [ "$OS_TYPE" == "Darwin" ]; then
    # macOS downloads
    download "${CORTEX_RELEASE_URL}/v${CORTEX_VERSION}/cortex-${CORTEX_VERSION}-mac-universal.tar.gz" 1 "${BIN_PATH}"
    mv ./cortex-server-beta ./cortex-server
    rm -rf ./cortex
    rm -rf ./cortex-beta
    chmod +x "./cortex-server"
    mv ./cortex-server ./cortex-server-universal-apple-darwin
    cp ./cortex-server-universal-apple-darwin ./cortex-server-aarch64-apple-darwin
    cp ./cortex-server-universal-apple-darwin ./cortex-server-x86_64-apple-darwin 

    # Download engines for macOS
    download "${ENGINE_DOWNLOAD_URL}-macos-arm64.tar.gz" 2 "${SHARED_PATH}/engines/llama.cpp/macos-arm64/${ENGINE_VERSION}"
    download "${ENGINE_DOWNLOAD_URL}-macos-x64.tar.gz" 2 "${SHARED_PATH}/engines/llama.cpp/macos-x64/${ENGINE_VERSION}"


else
    echo "Unsupported operating system: $OS_TYPE"
    exit 1
fi

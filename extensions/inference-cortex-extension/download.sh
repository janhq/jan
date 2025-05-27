#!/bin/bash

# Read CORTEX_VERSION
CORTEX_VERSION=$(cat ./bin/version.txt)
ENGINE_VERSION=b5509
CORTEX_RELEASE_URL="https://github.com/menloresearch/cortex.cpp/releases/download"
ENGINE_DOWNLOAD_URL=https://github.com/menloresearch/llama.cpp/releases/download/${ENGINE_VERSION}/llama-${ENGINE_VERSION}-bin
CUDA_DOWNLOAD_URL=https://github.com/menloresearch/llama.cpp/releases/download/${ENGINE_VERSION}
BIN_PATH=./bin
SHARED_PATH="../../electron/shared"
# Detect platform
OS_TYPE=$(uname)

if [ "$OS_TYPE" == "Linux" ]; then
    # Linux downloads
    download "${CORTEX_RELEASE_URL}/v${CORTEX_VERSION}/cortex-${CORTEX_VERSION}-linux-amd64.tar.gz" -e --strip 1 -o "./bin"
    mv ./bin/cortex-server-beta ./bin/cortex-server
    rm -rf ./bin/cortex
    rm -rf ./bin/cortex-beta
    chmod +x "./bin/cortex-server"

    # Download engines for Linux
    download "${ENGINE_DOWNLOAD_URL}-linux-noavx-x64.tar.gz" -e --strip 2 -o "${SHARED_PATH}/engines/llama.cpp/linux-noavx-x64/${ENGINE_VERSION}" 1
    download "${ENGINE_DOWNLOAD_URL}-linux-avx-x64.tar.gz" -e --strip 2 -o "${SHARED_PATH}/engines/llama.cpp/linux-avx-x64/${ENGINE_VERSION}" 1
    download "${ENGINE_DOWNLOAD_URL}-linux-avx2-x64.tar.gz" -e --strip 2 -o "${SHARED_PATH}/engines/llama.cpp/linux-avx2-x64/${ENGINE_VERSION}" 1
    download "${ENGINE_DOWNLOAD_URL}-linux-avx512-x64.tar.gz" -e --strip 2 -o "${SHARED_PATH}/engines/llama.cpp/linux-avx512-x64/${ENGINE_VERSION}" 1
    download "${ENGINE_DOWNLOAD_URL}-linux-avx2-cuda-cu12.0-x64.tar.gz" -e --strip 2 -o "${SHARED_PATH}/engines/llama.cpp/linux-avx2-cuda-cu12.0-x64/${ENGINE_VERSION}" 1
    download "${ENGINE_DOWNLOAD_URL}-linux-avx2-cuda-cu11.7-x64.tar.gz" -e --strip 2 -o "${SHARED_PATH}/engines/llama.cpp/linux-avx2-cuda-cu11.7-x64/${ENGINE_VERSION}" 1
    download "${ENGINE_DOWNLOAD_URL}-linux-noavx-cuda-cu12.0-x64.tar.gz" -e --strip 2 -o "${SHARED_PATH}/engines/llama.cpp/linux-noavx-cuda-cu12.0-x64/${ENGINE_VERSION}" 1
    download "${ENGINE_DOWNLOAD_URL}-linux-noavx-cuda-cu11.7-x64.tar.gz" -e --strip 2 -o "${SHARED_PATH}/engines/llama.cpp/linux-noavx-cuda-cu11.7-x64/${ENGINE_VERSION}" 1
    download "${ENGINE_DOWNLOAD_URL}-linux-vulkan-x64.tar.gz" -e --strip 2 -o "${SHARED_PATH}/engines/llama.cpp/linux-vulkan-x64/${ENGINE_VERSION}" 1
    download "${CUDA_DOWNLOAD_URL}/cudart-llama-bin-linux-cu12.0-x64.tar.gz" -e --strip 1 -o "${BIN_PATH}" 1
    download "${CUDA_DOWNLOAD_URL}/cudart-llama-bin-linux-cu11.7-x64.tar.gz" -e --strip 1 -o "${BIN_PATH}" 1

elif [ "$OS_TYPE" == "Darwin" ]; then
    # macOS downloads
    download "${CORTEX_RELEASE_URL}/v${CORTEX_VERSION}/cortex-${CORTEX_VERSION}-mac-universal.tar.gz" -e --strip 1 -o "./bin" 1
    mv ./bin/cortex-server-beta ./bin/cortex-server
    rm -rf ./bin/cortex
    rm -rf ./bin/cortex-beta
    chmod +x "./bin/cortex-server"

    # Download engines for macOS
    download "${ENGINE_DOWNLOAD_URL}-macos-arm64.tar.gz" -e --strip 2 -o "${SHARED_PATH}/engines/llama.cpp/macos-arm64/${ENGINE_VERSION}"
    download "${ENGINE_DOWNLOAD_URL}-macos-x64.tar.gz" -e --strip 2 -o "${SHARED_PATH}/engines/llama.cpp/macos-x64/${ENGINE_VERSION}"

else
    echo "Unsupported operating system: $OS_TYPE"
    exit 1
fi

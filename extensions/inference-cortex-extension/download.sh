#!/bin/bash

# Read CORTEX_VERSION
CORTEX_VERSION=$(cat ./bin/version.txt)
ENGINE_VERSION=0.1.42
CORTEX_RELEASE_URL="https://github.com/janhq/cortex.cpp/releases/download"
ENGINE_DOWNLOAD_URL="https://github.com/janhq/cortex.llamacpp/releases/download/v${ENGINE_VERSION}/cortex.llamacpp-${ENGINE_VERSION}"
CUDA_DOWNLOAD_URL="https://github.com/janhq/cortex.llamacpp/releases/download/v${ENGINE_VERSION}"
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
    download "${ENGINE_DOWNLOAD_URL}-linux-amd64-noavx.tar.gz" -e --strip 1 -o "${SHARED_PATH}/engines/cortex.llamacpp/linux-amd64-noavx/v${ENGINE_VERSION}" 1
    download "${ENGINE_DOWNLOAD_URL}-linux-amd64-avx.tar.gz" -e --strip 1 -o "${SHARED_PATH}/engines/cortex.llamacpp/linux-amd64-avx/v${ENGINE_VERSION}" 1
    download "${ENGINE_DOWNLOAD_URL}-linux-amd64-avx2.tar.gz" -e --strip 1 -o "${SHARED_PATH}/engines/cortex.llamacpp/linux-amd64-avx2/v${ENGINE_VERSION}" 1
    download "${ENGINE_DOWNLOAD_URL}-linux-amd64-avx512.tar.gz" -e --strip 1 -o "${SHARED_PATH}/engines/cortex.llamacpp/linux-amd64-avx512/v${ENGINE_VERSION}" 1
    download "${ENGINE_DOWNLOAD_URL}-linux-amd64-avx2-cuda-12-0.tar.gz" -e --strip 1 -o "${SHARED_PATH}/engines/cortex.llamacpp/linux-amd64-avx2-cuda-12-0/v${ENGINE_VERSION}" 1
    download "${ENGINE_DOWNLOAD_URL}-linux-amd64-avx2-cuda-11-7.tar.gz" -e --strip 1 -o "${SHARED_PATH}/engines/cortex.llamacpp/linux-amd64-avx2-cuda-11-7/v${ENGINE_VERSION}" 1
    download "${ENGINE_DOWNLOAD_URL}-linux-amd64-noavx-cuda-12-0.tar.gz" -e --strip 1 -o "${SHARED_PATH}/engines/cortex.llamacpp/linux-amd64-noavx-cuda-12-0/v${ENGINE_VERSION}" 1
    download "${ENGINE_DOWNLOAD_URL}-linux-amd64-noavx-cuda-11-7.tar.gz" -e --strip 1 -o "${SHARED_PATH}/engines/cortex.llamacpp/linux-amd64-noavx-cuda-11-7/v${ENGINE_VERSION}" 1
    download "${ENGINE_DOWNLOAD_URL}-linux-amd64-vulkan.tar.gz" -e --strip 1 -o "${SHARED_PATH}/engines/cortex.llamacpp/linux-amd64-vulkan/v${ENGINE_VERSION}" 1
    download "${CUDA_DOWNLOAD_URL}/cuda-12-0-linux-amd64.tar.gz" -e --strip 1 -o "${SHARED_PATH}" 1
    download "${CUDA_DOWNLOAD_URL}/cuda-11-7-linux-amd64.tar.gz" -e --strip 1 -o "${SHARED_PATH}" 1

elif [ "$OS_TYPE" == "Darwin" ]; then
    # macOS downloads
    download "${CORTEX_RELEASE_URL}/v${CORTEX_VERSION}/cortex-${CORTEX_VERSION}-mac-universal.tar.gz" -e --strip 1 -o "./bin" 1
    mv ./bin/cortex-server-beta ./bin/cortex-server
    rm -rf ./bin/cortex
    rm -rf ./bin/cortex-beta
    chmod +x "./bin/cortex-server"

    # Download engines for macOS
    download "${ENGINE_DOWNLOAD_URL}-mac-arm64.tar.gz" -e --strip 1 -o "${SHARED_PATH}/engines/cortex.llamacpp/mac-arm64/v${ENGINE_VERSION}"
    download "${ENGINE_DOWNLOAD_URL}-mac-amd64.tar.gz" -e --strip 1 -o "${SHARED_PATH}/engines/cortex.llamacpp/mac-amd64/v${ENGINE_VERSION}"

else
    echo "Unsupported operating system: $OS_TYPE"
    exit 1
fi

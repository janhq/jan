#!/bin/bash

# Read CORTEX_VERSION
CORTEX_VERSION=$(cat ./bin/version.txt)
CORTEX_RELEASE_URL="https://github.com/janhq/cortex/releases/download"
ENGINE_DOWNLOAD_URL="https://github.com/janhq/cortex.llamacpp/releases/download/v0.1.34/cortex.llamacpp-0.1.34"
# Detect platform
OS_TYPE=$(uname)

if [ "$OS_TYPE" == "Linux" ]; then
    # Linux downloads
    download "${CORTEX_RELEASE_URL}/v${CORTEX_VERSION}/cortex-${CORTEX_VERSION}-linux-amd64.tar.gz" -e --strip 1 -o "./bin"
    chmod +x "./bin/cortex"

    # Download engines for Linux
    download "${ENGINE_DOWNLOAD_URL}-linux-amd64-noavx.tar.gz" -e --strip 1 -o "./bin/noavx/engines/cortex.llamacpp" 1
    download "${ENGINE_DOWNLOAD_URL}-linux-amd64-avx.tar.gz" -e --strip 1 -o "./bin/avx/engines/cortex.llamacpp" 1
    download "${ENGINE_DOWNLOAD_URL}-linux-amd64-avx2.tar.gz" -e --strip 1 -o "./bin/avx2/engines/cortex.llamacpp" 1
    download "${ENGINE_DOWNLOAD_URL}-linux-amd64-avx512.tar.gz" -e --strip 1 -o "./bin/avx512/engines/cortex.llamacpp" 1
    download "${ENGINE_DOWNLOAD_URL}-linux-amd64-avx2-cuda-12-0.tar.gz" -e --strip 1 -o "./bin/avx2-cuda-12-0/engines/cortex.llamacpp" 1
    download "${ENGINE_DOWNLOAD_URL}-linux-amd64-avx2-cuda-11-7.tar.gz" -e --strip 1 -o "./bin/avx2-cuda-11-7/engines/cortex.llamacpp" 1
    download "${ENGINE_DOWNLOAD_URL}-linux-amd64-noavx-cuda-12-0.tar.gz" -e --strip 1 -o "./bin/noavx-cuda-12-0/engines/cortex.llamacpp" 1
    download "${ENGINE_DOWNLOAD_URL}-linux-amd64-noavx-cuda-11-7.tar.gz" -e --strip 1 -o "./bin/noavx-cuda-11-7/engines/cortex.llamacpp" 1
    download "${ENGINE_DOWNLOAD_URL}-linux-amd64-vulkan.tar.gz" -e --strip 1 -o "./bin/vulkan/engines/cortex.llamacpp" 1
    download "${ENGINE_DOWNLOAD_URL}-cuda-12-0-linux-amd64.tar.gz" -e --strip 1 -o "./bin" 1
    download "${ENGINE_DOWNLOAD_URL}-cuda-11-7-linux-amd64.tar.gz" -e --strip 1 -o "./bin" 1

elif [ "$OS_TYPE" == "Darwin" ]; then
    # macOS downloads
    download "${CORTEX_RELEASE_URL}/v${CORTEX_VERSION}/cortex-${CORTEX_VERSION}-mac-universal.tar.gz" -e --strip 1 -o "./bin" 1
    chmod +x "./bin/cortex"

    # Download engines for macOS
    download "${ENGINE_DOWNLOAD_URL}-mac-arm64.tar.gz" -e --strip 1 -o ./bin/arm64/engines/cortex.llamacpp
    download "${ENGINE_DOWNLOAD_URL}-mac-amd64.tar.gz" -e --strip 1 -o ./bin/x64/engines/cortex.llamacpp

else
    echo "Unsupported operating system: $OS_TYPE"
    exit 1
fi

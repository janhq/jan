#!/bin/bash

# Read CORTEX_VERSION
CORTEX_VERSION=$(cat ./bin/version.txt)
CORTEX_RELEASE_URL="https://github.com/janhq/cortex/releases/download"

# Detect platform
OS_TYPE=$(uname)

if [ "$OS_TYPE" == "Linux" ]; then
    # Linux downloads
    download "${CORTEX_RELEASE_URL}/v${CORTEX_VERSION}/cortex-cpp-${CORTEX_VERSION}-linux-amd64.tar.gz"  -e --strip 1 -o "./bin"
    chmod +x "./bin/cortex-cpp"

    ENGINE_DOWNLOAD_URL="https://github.com/janhq/cortex.llamacpp/releases/download/v0.1.25/cortex.llamacpp-0.1.25-linux-amd64"

    # Download engines for Linux
    download "${ENGINE_DOWNLOAD_URL}-noavx.tar.gz"  -e --strip 1 -o "./bin/linux-noavx/engines/cortex.llamacpp" 1
    download "${ENGINE_DOWNLOAD_URL}-avx.tar.gz"  -e --strip 1 -o "./bin/linux-avx/engines/cortex.llamacpp" 1
    download "${ENGINE_DOWNLOAD_URL}-avx2.tar.gz"  -e --strip 1 -o "./bin/linux-avx2/engines/cortex.llamacpp" 1
    download "${ENGINE_DOWNLOAD_URL}-avx512.tar.gz"  -e --strip 1 -o "./bin/linux-avx512/engines/cortex.llamacpp" 1
    download "${ENGINE_DOWNLOAD_URL}-avx2-cuda-12-0.tar.gz"  -e --strip 1 -o "./bin/linux-cuda-12-0/engines/cortex.llamacpp" 1
    download "${ENGINE_DOWNLOAD_URL}-avx2-cuda-11-7.tar.gz"  -e --strip 1 -o "./bin/linux-cuda-11-7/engines/cortex.llamacpp" 1
    download "${ENGINE_DOWNLOAD_URL}-vulkan.tar.gz"  -e --strip 1 -o "./bin/linux-vulkan/engines/cortex.llamacpp" 1

elif [ "$OS_TYPE" == "Darwin" ]; then
    # macOS downloads
    download "${CORTEX_RELEASE_URL}/v${CORTEX_VERSION}/cortex-cpp-${CORTEX_VERSION}-mac-arm64.tar.gz"  -e --strip 1 -o "./bin/mac-arm64" 1
    download "${CORTEX_RELEASE_URL}/v${CORTEX_VERSION}/cortex-cpp-${CORTEX_VERSION}-mac-amd64.tar.gz"  -e --strip 1 -o "./bin/mac-x64" 1
    chmod +x "./bin/mac-arm64/cortex-cpp"
    chmod +x "./bin/mac-x64/cortex-cpp"

    ENGINE_DOWNLOAD_URL="https://github.com/janhq/cortex.llamacpp/releases/download/v0.1.25/cortex.llamacpp-0.1.25-mac"
    # Download engines for macOS
    download "${ENGINE_DOWNLOAD_URL}-arm64.tar.gz" -e --strip 1 -o ./bin/mac-arm64/engines/cortex.llamacpp
    download "${ENGINE_DOWNLOAD_URL}-amd64.tar.gz" -e --strip 1 -o ./bin/mac-x64/engines/cortex.llamacpp

else
    echo "Unsupported operating system: $OS_TYPE"
    exit 1
fi

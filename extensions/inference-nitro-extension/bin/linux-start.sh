#!/bin/bash

# Check if nvidia-smi exists and is executable
if ! command -v nvidia-smi &> /dev/null; then
    echo "nvidia-smi not found, proceeding with CPU version..."
    cd linux-cpu
    ./nitro "$@"
    exit $?
fi

# Find the GPU with the highest VRAM
readarray -t gpus < <(nvidia-smi --query-gpu=index,memory.total --format=csv,noheader,nounits)
maxMemory=0
selectedGpuId=0

for gpu in "${gpus[@]}"; do
    IFS=, read -ra gpuInfo <<< "$gpu"
    gpuId=${gpuInfo[0]}
    gpuMemory=${gpuInfo[1]}
    if (( gpuMemory > maxMemory )); then
        maxMemory=$gpuMemory
        selectedGpuId=$gpuId
    fi
done

echo "Selected GPU: $selectedGpuId"
export CUDA_VISIBLE_DEVICES=$selectedGpuId

# Attempt to run nitro_linux_amd64_cuda
cd linux-cuda
if ./nitro "$@"; then
    exit $?
else
    echo "nitro_linux_amd64_cuda encountered an error, attempting to run nitro_linux_amd64..."
    cd ../linux-cpu
    ./nitro "$@"
    exit $?
fi
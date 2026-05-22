#Requires -Version 5.1
# scripts/download-llamacpp-cudart-windows.ps1
# Atomic Chat — merge CUDA Toolkit runtime DLLs into a Windows llama.cpp
# backend bundle.
#
# Per ADR 2026-05-22 ("Windows ships only `llamacpp-upstream`") the Windows
# `llama-{tag}-bin-win-cuda-{12.4,13.1}-x64.zip` archives are sourced from
# ggml-org/llama.cpp. They ship llama-server.exe + direct deps only; the
# CUDA Toolkit runtime DLLs (cudart64_*.dll, cublas64_*.dll,
# cublasLt64_*.dll, …) live in companion `cudart-llama-bin-win-cuda-{X.Y}-x64.zip`
# archives on the same release. Without those DLLs,
# `llama-server.exe --list-devices` returns an empty device list on machines
# that don't have the CUDA Toolkit installed system-wide
# (cf. AtomicBot-ai/Atomic-Chat#14).
#
# This script:
#   1. Maps `win-cuda-{12.4,13.1}-x64` → matching cudart archive name.
#   2. Downloads the archive from the same ggml-org/llama.cpp release.
#   3. Extracts it to a temp dir and copies every *.dll into
#      <BackendDir>/build/bin/.
#
# Idempotent — no-op when the cudart marker DLL is already present, or
# when the backend is not a Windows CUDA variant.
#
# Usage:
#   powershell -ExecutionPolicy Bypass -File scripts/download-llamacpp-cudart-windows.ps1 `
#       -BackendDir src-tauri/resources/llamacpp-backend-upstream `
#       -Backend win-cuda-13.1-x64 `
#       -Tag b8892

param(
    [Parameter(Mandatory = $true)][string]$BackendDir,
    [Parameter(Mandatory = $true)][string]$Backend,
    [Parameter(Mandatory = $true)][string]$Tag
)

$ErrorActionPreference = 'Stop'

# Mapping mirrors `WINDOWS_CUDART_FILENAME` in
# extensions/llamacpp-upstream-extension/src/backend.ts. ggml-org dropped
# CUDA 11 — hosts whose driver only supports CUDA 11 fall back to the CPU
# build via runtime driver-version gating, so there's no `cuda-11` entry.
# Marker DLL = soname-versioned cudart filename for each toolkit version.
$cudaMap = @{
    'cuda-12.4' = @{ Archive = 'cudart-llama-bin-win-cuda-12.4-x64.zip'; Marker = 'cudart64_12.dll' }
    'cuda-13.1' = @{ Archive = 'cudart-llama-bin-win-cuda-13.1-x64.zip'; Marker = 'cudart64_13.dll' }
}

if ($Backend -notmatch '^win-(cuda-(?:12\.4|13\.1))-x64$') {
    Write-Host "  Backend '$Backend' is not a Windows CUDA variant, skipping cudart merge."
    exit 0
}
$cudaKey = $Matches[1]
$entry = $cudaMap[$cudaKey]
$archiveName = $entry.Archive
$markerDll = $entry.Marker

$buildBinDir = Join-Path $BackendDir 'build/bin'
$markerPath = Join-Path $buildBinDir $markerDll
if (Test-Path $markerPath) {
    Write-Host "  cudart already present at $markerPath, skipping cudart merge."
    exit 0
}

if (-not (Test-Path $buildBinDir)) {
    New-Item -ItemType Directory -Path $buildBinDir -Force | Out-Null
}

$url = "https://github.com/ggml-org/llama.cpp/releases/download/$Tag/$archiveName"
$archivePath = Join-Path $env:TEMP $archiveName
$extractDir = Join-Path $env:TEMP ("cudart-" + $cudaKey + "-" + $Tag)

Write-Host "  Downloading cudart: $url"
try {
    if (Test-Path $extractDir) { Remove-Item $extractDir -Recurse -Force }
    New-Item -ItemType Directory -Path $extractDir -Force | Out-Null

    Invoke-WebRequest -Uri $url -OutFile $archivePath -UseBasicParsing
    Write-Host "  Extracting cudart to $extractDir"
    Expand-Archive -Path $archivePath -DestinationPath $extractDir -Force

    $dllFiles = Get-ChildItem -Path $extractDir -Filter '*.dll' -File -Recurse -ErrorAction SilentlyContinue
    if (-not $dllFiles -or $dllFiles.Count -eq 0) {
        throw "cudart archive $archiveName contained no DLLs"
    }

    foreach ($dll in $dllFiles) {
        Copy-Item -Path $dll.FullName -Destination $buildBinDir -Force
    }
    Write-Host "  Merged $($dllFiles.Count) cudart DLL(s) into $buildBinDir" -ForegroundColor Green
}
finally {
    if (Test-Path $archivePath) { Remove-Item $archivePath -Force -ErrorAction SilentlyContinue }
    if (Test-Path $extractDir) { Remove-Item $extractDir -Recurse -Force -ErrorAction SilentlyContinue }
}

#Requires -Version 5.1
# scripts/download-llamacpp-cudart-windows.ps1
# Atomic Chat - merge CUDA Toolkit runtime DLLs into a Windows llamacpp backend.
#
# The `llama-{tag}-bin-win-cuda-{11,12,13}-*-x64.tar.gz` archives that the app
# downloads from janhq/llama.cpp ship llama-server.exe + direct deps only; the
# CUDA Toolkit runtime DLLs (cudart64_*.dll, cublas64_*.dll, cublasLt64_*.dll,
# …) live in a sibling `cudart-llama-bin-win-cu{X.Y}-x64.tar.gz`. Without those
# DLLs, `llama-server.exe --list-devices` returns an empty device list on
# machines that don't have the CUDA Toolkit installed system-wide
# (AtomicBot-ai/Atomic-Chat#14).
#
# This script:
#   1. Maps `win-cuda-{11,12,13}-…` -> matching cudart archive name.
#   2. Downloads the archive from the same janhq/llama.cpp release.
#   3. Extracts it to a temp dir and copies every *.dll into
#      <BackendDir>/build/bin/.
#
# Idempotent — no-op when the cudart DLL is already present, or when the
# backend is not a Windows CUDA variant.
#
# Usage:
#   powershell -ExecutionPolicy Bypass -File scripts/download-llamacpp-cudart-windows.ps1 `
#       -BackendDir src-tauri/resources/llamacpp-backend `
#       -Backend win-cuda-13-common_cpus-x64 `
#       -Tag b8892

param(
    [Parameter(Mandatory = $true)][string]$BackendDir,
    [Parameter(Mandatory = $true)][string]$Backend,
    [Parameter(Mandatory = $true)][string]$Tag
)

$ErrorActionPreference = 'Stop'

# win-cuda-11-… → cu11.7 / cudart64_110.dll
# win-cuda-12-… → cu12.0 / cudart64_12.dll
# win-cuda-13-… → cu13.0 / cudart64_13.dll
$cudaMap = @{
    'cuda-11' = @{ Archive = 'cudart-llama-bin-win-cu11.7-x64.tar.gz'; Marker = 'cudart64_110.dll' }
    'cuda-12' = @{ Archive = 'cudart-llama-bin-win-cu12.0-x64.tar.gz'; Marker = 'cudart64_12.dll' }
    'cuda-13' = @{ Archive = 'cudart-llama-bin-win-cu13.0-x64.tar.gz'; Marker = 'cudart64_13.dll' }
}

if ($Backend -notmatch '^win-(cuda-(?:11|12|13))-') {
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

$url = "https://github.com/janhq/llama.cpp/releases/download/$Tag/$archiveName"
$archivePath = Join-Path $env:TEMP $archiveName
$extractDir = Join-Path $env:TEMP ("cudart-" + $cudaKey + "-" + $Tag)

Write-Host "  Downloading cudart: $url"
try {
    if (Test-Path $extractDir) { Remove-Item $extractDir -Recurse -Force }
    New-Item -ItemType Directory -Path $extractDir -Force | Out-Null

    Invoke-WebRequest -Uri $url -OutFile $archivePath -UseBasicParsing
    Write-Host "  Extracting cudart to $extractDir"
    tar -xzf $archivePath -C $extractDir

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

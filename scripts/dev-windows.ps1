#Requires -Version 5.1
# scripts/dev-windows.ps1
# Atomic Chat - Windows development launcher
# Mirrors CI pipeline: install deps, download backend, build CLI, run dev
#
# Usage:
#   powershell -ExecutionPolicy Bypass -File scripts/dev-windows.ps1
#   - or -
#   make dev-windows
#
# Flags:
#   -SkipBackendDownload  Reuse the llamacpp backend already present under
#                         src-tauri/resources/llamacpp-backend (used by
#                         `make dev-windows-fast` for quick iteration).

param(
    [switch]$SkipBackendDownload
)

$ErrorActionPreference = 'Stop'

$projectRoot = $PSScriptRoot | Split-Path
Set-Location $projectRoot

function Write-Step {
    param([string]$msg)
    Write-Host ''
    Write-Host ">>> $msg" -ForegroundColor Cyan
}

function Test-Cmd {
    param([string]$cmd)
    return ($null -ne (Get-Command $cmd -ErrorAction SilentlyContinue))
}

function Refresh-SessionPath {
    $machinePath = [System.Environment]::GetEnvironmentVariable('Path', 'Machine')
    $userPath = [System.Environment]::GetEnvironmentVariable('Path', 'User')
    $env:Path = $machinePath + ';' + $userPath
}

function Assert-Cmd {
    param([string]$cmd, [string]$hint)
    if (-not (Test-Cmd $cmd)) {
        Write-Host "[FATAL] $cmd not found. $hint" -ForegroundColor Red
        Write-Host 'Run: make setup-windows' -ForegroundColor Yellow
        exit 1
    }
}

# ── Ensure nvm + Node.js are available ────────────────────────
Write-Step 'Ensuring nvm + Node.js are available'
Refresh-SessionPath

# Ensure NVM_HOME is set
if (-not $env:NVM_HOME) {
    $nvmHome = [System.Environment]::GetEnvironmentVariable('NVM_HOME', 'User')
    if (-not $nvmHome) {
        $nvmHome = [System.Environment]::GetEnvironmentVariable('NVM_HOME', 'Machine')
    }
    if (-not $nvmHome) {
        $nvmHome = Join-Path $env:APPDATA 'nvm'
    }
    $env:NVM_HOME = $nvmHome
}

if (-not $env:NVM_SYMLINK) {
    $nvmSymlink = [System.Environment]::GetEnvironmentVariable('NVM_SYMLINK', 'User')
    if (-not $nvmSymlink) {
        $nvmSymlink = [System.Environment]::GetEnvironmentVariable('NVM_SYMLINK', 'Machine')
    }
    if (-not $nvmSymlink) {
        $nvmSymlink = Join-Path $env:ProgramFiles 'nodejs'
    }
    $env:NVM_SYMLINK = $nvmSymlink
}

# Add nvm to PATH if missing
if ((Test-Path $env:NVM_HOME) -and ($env:Path -notlike "*$($env:NVM_HOME)*")) {
    $env:Path = $env:NVM_HOME + ';' + $env:Path
}
if ($env:Path -notlike "*$($env:NVM_SYMLINK)*") {
    $env:Path = $env:NVM_SYMLINK + ';' + $env:Path
}

# Ensure settings.txt exists
$settingsFile = Join-Path $env:NVM_HOME 'settings.txt'
if ((Test-Path $env:NVM_HOME) -and (-not (Test-Path $settingsFile))) {
    Write-Host "  Creating nvm settings.txt..."
    $settingsContent = "root: $($env:NVM_HOME)`r`npath: $($env:NVM_SYMLINK)"
    [System.IO.File]::WriteAllText($settingsFile, $settingsContent)
}

# Install + activate Node.js 20 via nvm if node is missing
if (-not (Test-Cmd 'node')) {
    if (Test-Cmd 'nvm') {
        Write-Host '  Node.js not found. Installing Node.js 20 via nvm...'
        nvm install 20
        nvm use 20
        Refresh-SessionPath
        # Re-add symlink to PATH after nvm use
        if ($env:Path -notlike "*$($env:NVM_SYMLINK)*") {
            $env:Path = $env:NVM_SYMLINK + ';' + $env:Path
        }
    }
}

# Setup yarn via corepack (yarn 4.5.3 as declared in package.json)
if (Test-Cmd 'node') {
    # Use a dedicated writable directory for corepack shims
    # (nvm's node dir often has EPERM issues with corepack enable)
    $corepackBin = Join-Path $env:USERPROFILE '.corepack\bin'
    if (-not (Test-Path $corepackBin)) {
        New-Item -ItemType Directory -Path $corepackBin -Force | Out-Null
    }

    # Remove npm-global yarn v1 if present — it conflicts with corepack
    $npmPrefix = ((npm prefix -g 2>&1) | Out-String).Trim()
    $npmYarn = Join-Path $npmPrefix 'yarn.cmd'
    if (Test-Path $npmYarn) {
        Write-Host '  Removing conflicting npm-global yarn v1...'
        npm uninstall -g yarn 2>&1 | Out-Null
    }

    # Enable corepack shims in our writable directory
    Write-Host "  Enabling corepack (shim dir: $corepackBin)..."
    corepack enable --install-directory $corepackBin
    corepack prepare yarn@4.5.3 --activate

    # Add shim directory to PATH
    if ($env:Path -notlike "*$corepackBin*") {
        $env:Path = $corepackBin + ';' + $env:Path
    }
}

# Ensure cargo is on PATH
$cargoPath = Join-Path $env:USERPROFILE '.cargo\bin'
if ((Test-Path $cargoPath) -and ($env:Path -notlike "*\.cargo\bin*")) {
    $env:Path = $cargoPath + ';' + $env:Path
}

# ── Preflight checks ─────────────────────────────────────────
Write-Step 'Preflight checks'
Assert-Cmd 'node'   'Install via: nvm install 20 && nvm use 20'
Assert-Cmd 'cargo'  'Install via: make setup-windows (installs Rust)'

# Yarn check: search .cmd shim in known locations if not on PATH
if (-not (Test-Cmd 'yarn')) {
    $searchDirs = @(
        (Join-Path $env:USERPROFILE '.corepack\bin')
    )
    if (Test-Cmd 'node') { $searchDirs += Split-Path (Get-Command node).Source }
    if ($env:NVM_SYMLINK) { $searchDirs += $env:NVM_SYMLINK }

    $yarnFound = $false
    foreach ($dir in $searchDirs) {
        if (Test-Path (Join-Path $dir 'yarn.cmd')) {
            Write-Host "  yarn.cmd found in $dir"
            $env:Path = $dir + ';' + $env:Path
            $yarnFound = $true
            break
        }
    }
    if (-not $yarnFound) {
        Assert-Cmd 'yarn' 'Run: corepack enable --install-directory %USERPROFILE%\.corepack\bin'
    }
}

$nodeVer = (node --version 2>&1) | Out-String
$cargoVer = (cargo --version 2>&1) | Out-String
Write-Host "  node  $($nodeVer.Trim())"
Write-Host "  cargo $($cargoVer.Trim())"
Write-Host '  yarn  OK'

# ── Yarn install ──────────────────────────────────────────────
Write-Step 'yarn install'
yarn config set -H enableImmutableInstalls false 2>&1 | Out-Null
yarn install
if ($LASTEXITCODE -ne 0) { Write-Host 'yarn install failed' -ForegroundColor Red; exit 1 }

# ── Build tauri plugin API ────────────────────────────────────
Write-Step 'yarn build:tauri:plugin:api'
yarn build:tauri:plugin:api
if ($LASTEXITCODE -ne 0) { Write-Host 'build:tauri:plugin:api failed' -ForegroundColor Red; exit 1 }

# ── Build core ────────────────────────────────────────────────
Write-Step 'yarn build:core'
yarn build:core
if ($LASTEXITCODE -ne 0) { Write-Host 'build:core failed' -ForegroundColor Red; exit 1 }

# ── Build extensions ──────────────────────────────────────────
Write-Step 'yarn build:extensions'
yarn build:extensions
if ($LASTEXITCODE -ne 0) { Write-Host 'build:extensions failed' -ForegroundColor Red; exit 1 }

# ── Download binaries (bun, uv, sqlite-vec) ───────────────────
Write-Step 'yarn download:bin'
yarn download:bin
if ($LASTEXITCODE -ne 0) { Write-Host 'download:bin failed' -ForegroundColor Red; exit 1 }

# ── Detect GPU hardware and select best backend ──────────────
Write-Step 'Detecting GPU hardware'

function Get-NvidiaDriverVersion {
    try {
        $gpu = Get-CimInstance -ClassName Win32_VideoController -ErrorAction Stop |
            Where-Object { $_.Name -match 'NVIDIA' } |
            Select-Object -First 1
        if ($gpu -and $gpu.DriverVersion) {
            # Windows driver version format: a.bb.cc.dddd → NVIDIA version = cdd.dd
            # e.g. 32.0.15.6094 → 560.94, 31.0.15.2741 → 527.41
            $raw = $gpu.DriverVersion -replace '\.', ''
            if ($raw.Length -ge 5) {
                $nv = $raw.Substring($raw.Length - 5)
                $major = $nv.Substring(0, 3).TrimStart('0')
                $minor = $nv.Substring(3, 2)
                if (-not $major) { $major = '0' }
                return "$major.$minor"
            }
        }
    } catch {}
    return $null
}

function Compare-VersionStrings {
    param([string]$v1, [string]$v2)
    $p1 = $v1.Split('.') | ForEach-Object { [int]$_ }
    $p2 = $v2.Split('.') | ForEach-Object { [int]$_ }
    $max = [Math]::Max($p1.Count, $p2.Count)
    for ($i = 0; $i -lt $max; $i++) {
        $n1 = if ($i -lt $p1.Count) { $p1[$i] } else { 0 }
        $n2 = if ($i -lt $p2.Count) { $p2[$i] } else { 0 }
        if ($n1 -lt $n2) { return -1 }
        if ($n1 -gt $n2) { return 1 }
    }
    return 0
}

function Test-VulkanSupport {
    # Check for Vulkan runtime DLL (present when any Vulkan-capable GPU + driver is installed)
    $vulkanDll = Join-Path $env:SystemRoot 'System32\vulkan-1.dll'
    return (Test-Path $vulkanDll)
}

$nvidiaDriver = Get-NvidiaDriverVersion
$hasVulkan = Test-VulkanSupport
$cudaTier = $null

if ($nvidiaDriver) {
    Write-Host "  NVIDIA GPU detected, driver version: $nvidiaDriver" -ForegroundColor Green

    # Thresholds match src-tauri/plugins/tauri-plugin-llamacpp/src/backend.rs
    if ((Compare-VersionStrings $nvidiaDriver '580') -ge 0) {
        $cudaTier = 13
        Write-Host "  CUDA tier: 13 (driver >= 580)" -ForegroundColor Green
    } elseif ((Compare-VersionStrings $nvidiaDriver '527.41') -ge 0) {
        $cudaTier = 12
        Write-Host "  CUDA tier: 12 (driver >= 527.41)" -ForegroundColor Green
    } elseif ((Compare-VersionStrings $nvidiaDriver '452.39') -ge 0) {
        $cudaTier = 11
        Write-Host "  CUDA tier: 11 (driver >= 452.39)" -ForegroundColor Green
    } else {
        Write-Host "  NVIDIA driver too old for CUDA ($nvidiaDriver < 452.39)" -ForegroundColor Yellow
    }
} else {
    Write-Host '  No NVIDIA GPU detected' -ForegroundColor Yellow
}

if ($hasVulkan) {
    Write-Host '  Vulkan runtime: available' -ForegroundColor Green
} else {
    Write-Host '  Vulkan runtime: not found' -ForegroundColor Yellow
}

# Check GPU VRAM (>= 6 GiB threshold — matches runtime logic in extensions/llamacpp-extension/src/index.ts)
# Win32_VideoController.AdapterRAM is uint32 and caps at ~4 GiB, so we read
# the 64-bit qwMemorySize from the registry for accurate results.
$gpuVramMiB = 0
try {
    $regItems = Get-ItemProperty 'HKLM:\SYSTEM\ControlSet001\Control\Class\{4d36e968-e325-11ce-bfc1-08002be10318}\0*' `
        -Name 'HardwareInformation.qwMemorySize' -ErrorAction SilentlyContinue
    if ($regItems) {
        $maxBytes = ($regItems | ForEach-Object { $_.'HardwareInformation.qwMemorySize' } |
            Sort-Object -Descending | Select-Object -First 1)
        if ($maxBytes -and $maxBytes -gt 0) {
            $gpuVramMiB = [math]::Floor($maxBytes / 1048576)
        }
    }
} catch {}
if ($gpuVramMiB -eq 0) {
    try {
        $vramBytes = Get-CimInstance -ClassName Win32_VideoController -ErrorAction Stop |
            ForEach-Object { $_.AdapterRAM } |
            Sort-Object -Descending |
            Select-Object -First 1
        if ($vramBytes -and $vramBytes -gt 0) {
            $gpuVramMiB = [math]::Floor($vramBytes / 1048576)
        }
    } catch {}
}
$hasEnoughVram = $gpuVramMiB -ge 6144
Write-Host "  GPU VRAM: $gpuVramMiB MiB (enough for GPU inference: $hasEnoughVram)"

# Priority order matches prioritize_backends() in backend.rs:
#   With enough VRAM: cuda13 → cuda12 → cuda11 → vulkan → cpu
#   Without enough VRAM: cuda13 → cuda12 → cuda11 → cpu → vulkan
if ($cudaTier -ge 13) {
    $backend = 'win-cuda-13-common_cpus-x64'
} elseif ($cudaTier -ge 12) {
    $backend = 'win-cuda-12-common_cpus-x64'
} elseif ($cudaTier -ge 11) {
    $backend = 'win-cuda-11-common_cpus-x64'
} elseif ($hasVulkan -and $hasEnoughVram) {
    $backend = 'win-vulkan-common_cpus-x64'
} else {
    $backend = 'win-common_cpus-x64'
}

# Allow manual override via LLAMACPP_BACKEND env var
if ($env:LLAMACPP_BACKEND) {
    Write-Host "  Overriding backend via LLAMACPP_BACKEND env var: $env:LLAMACPP_BACKEND" -ForegroundColor Cyan
    $backend = $env:LLAMACPP_BACKEND
}

Write-Host ''
Write-Host "  Selected backend: $backend" -ForegroundColor Cyan

# ── Download llamacpp backend from janhq/llama.cpp ────────────
Write-Step "Download llamacpp backend: $backend"
$llamacppDir = 'src-tauri/resources/llamacpp-backend'
$llamaServerExe = "$llamacppDir/build/bin/llama-server.exe"
$backendTxtPath = "$llamacppDir/backend.txt"

# Re-download if backend type changed (e.g. switched GPU)
$existingBackend = $null
if (Test-Path $backendTxtPath) {
    $existingBackend = (Get-Content $backendTxtPath -Raw).Trim()
}

$skipDownload = $false
if ($SkipBackendDownload -and (Test-Path $llamaServerExe)) {
    $existingLabel = if ($existingBackend) { $existingBackend } else { '<unknown>' }
    Write-Host "  -SkipBackendDownload: reusing existing backend ($existingLabel), no fetch." -ForegroundColor Yellow
    if ($existingBackend) { $backend = $existingBackend }
    $skipDownload = $true
} elseif ((Test-Path $llamaServerExe) -and ($existingBackend -eq $backend)) {
    Write-Host "  llamacpp backend ($backend) already exists, skipping download."
    $skipDownload = $true
}

if ($skipDownload) {
    # nothing to do
} else {
    if ($SkipBackendDownload) {
        Write-Host '  -SkipBackendDownload set, but no llama-server.exe found — falling back to download.' -ForegroundColor Yellow
    }
    if ($existingBackend -and ($existingBackend -ne $backend)) {
        Write-Host "  Backend changed: $existingBackend -> $backend, re-downloading..." -ForegroundColor Yellow
        Remove-Item -Recurse -Force $llamacppDir -ErrorAction SilentlyContinue
    }

    if (-not (Test-Path $llamacppDir)) {
        New-Item -ItemType Directory -Path $llamacppDir -Force | Out-Null
    }

    $apiUrl = 'https://api.github.com/repos/janhq/llama.cpp/releases/latest'
    $headers = @{ 'User-Agent' = 'atomic-chat-dev' }
    if ($env:GH_TOKEN) {
        $headers['Authorization'] = "Bearer $env:GH_TOKEN"
    }

    Write-Host '  Fetching latest release tag...'
    $release = Invoke-RestMethod -Uri $apiUrl -Headers $headers -UseBasicParsing
    $tag = $release.tag_name
    if (-not $tag) {
        Write-Host '[FATAL] Failed to fetch latest release tag' -ForegroundColor Red
        exit 1
    }

    $archiveUrl = "https://github.com/janhq/llama.cpp/releases/download/$tag/llama-$tag-bin-$backend.tar.gz"
    $archivePath = Join-Path $env:TEMP 'llamacpp-backend.tar.gz'

    Write-Host "  Release: $tag  Backend: $backend"
    Write-Host "  Downloading: $archiveUrl"

    Invoke-WebRequest -Uri $archiveUrl -OutFile $archivePath -UseBasicParsing

    Set-Content -Path "$llamacppDir/version.txt" -Value $tag -NoNewline
    Set-Content -Path "$llamacppDir/backend.txt" -Value $backend -NoNewline

    Write-Host '  Extracting...'
    tar -xzf $archivePath -C $llamacppDir
    Remove-Item $archivePath -Force -ErrorAction SilentlyContinue

    # Relocate flat-extracted binaries into build/bin/ (matches CI logic)
    if (-not (Test-Path "$llamacppDir/build/bin/llama-server.exe")) {
        if (Test-Path "$llamacppDir/llama-server.exe") {
            Write-Host '  Relocating flat-extracted binaries into build/bin/...'
            New-Item -ItemType Directory -Path "$llamacppDir/build/bin" -Force | Out-Null
            Get-ChildItem -Path $llamacppDir -Filter '*.exe' -File |
                Move-Item -Destination "$llamacppDir/build/bin/" -Force
            Get-ChildItem -Path $llamacppDir -Filter '*.dll' -File -ErrorAction SilentlyContinue |
                Move-Item -Destination "$llamacppDir/build/bin/" -Force
        }
    }

    Write-Host "  llamacpp backend ($backend) downloaded successfully" -ForegroundColor Green
}

# ── Build CLI (debug) ─────────────────────────────────────────
Write-Step 'Build jan-cli (debug)'
$cliBin = 'src-tauri/resources/bin/jan-cli.exe'
if (-not (Test-Path 'src-tauri/resources/bin')) {
    New-Item -ItemType Directory -Path 'src-tauri/resources/bin' -Force | Out-Null
}

Push-Location src-tauri
cargo build --features cli --bin jan-cli
if ($LASTEXITCODE -ne 0) {
    Pop-Location
    Write-Host 'cargo build jan-cli failed' -ForegroundColor Red
    exit 1
}
Pop-Location

Copy-Item -Path 'src-tauri/target/debug/jan-cli.exe' -Destination $cliBin -Force
Write-Host "  CLI built: $cliBin"

# ── Generate icons (tauri icon, skip macOS-only Python padding) ─
Write-Step 'Generating icons (tauri icon)'
yarn tauri icon ./src-tauri/icons/icon.png
if ($LASTEXITCODE -ne 0) { Write-Host 'tauri icon failed' -ForegroundColor Red; exit 1 }

# ── Copy assets for Tauri ──────────────────────────────────────
Write-Step 'Copying assets for Tauri'
yarn copy:assets:tauri
if ($LASTEXITCODE -ne 0) { Write-Host 'copy:assets:tauri failed' -ForegroundColor Red; exit 1 }

# ── Launch dev server ──────────────────────────────────────────
Write-Step 'Starting dev server (tauri dev)'
$env:IS_CLEAN = 'true'
# Force IPv4 to avoid localhost→::1 mismatch between Vite and Tauri on Windows
$env:TAURI_DEV_HOST = '127.0.0.1'
yarn tauri dev --config '{\"build\":{\"devUrl\":\"http://127.0.0.1:1420\"}}'

#Requires -Version 5.1
# scripts/build-windows-release.ps1
# Atomic Chat - Windows release builder (local, no code signing)
# Mirrors CI pipeline from release.yml: CPU-only backend, NSIS + MSI installers.
#
# Usage:
#   powershell -ExecutionPolicy Bypass -File scripts/build-windows-release.ps1
#   - or -
#   make build-windows-release

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

if ((Test-Path $env:NVM_HOME) -and ($env:Path -notlike "*$($env:NVM_HOME)*")) {
    $env:Path = $env:NVM_HOME + ';' + $env:Path
}
if ($env:Path -notlike "*$($env:NVM_SYMLINK)*") {
    $env:Path = $env:NVM_SYMLINK + ';' + $env:Path
}

if (-not (Test-Cmd 'node')) {
    if (Test-Cmd 'nvm') {
        Write-Host '  Node.js not found. Installing Node.js 20 via nvm...'
        nvm install 20
        nvm use 20
        Refresh-SessionPath
        if ($env:Path -notlike "*$($env:NVM_SYMLINK)*") {
            $env:Path = $env:NVM_SYMLINK + ';' + $env:Path
        }
    }
}

# Setup yarn via corepack
if (Test-Cmd 'node') {
    $corepackBin = Join-Path $env:USERPROFILE '.corepack\bin'
    if (-not (Test-Path $corepackBin)) {
        New-Item -ItemType Directory -Path $corepackBin -Force | Out-Null
    }

    $npmPrefix = ((npm prefix -g 2>&1) | Out-String).Trim()
    $npmYarn = Join-Path $npmPrefix 'yarn.cmd'
    if (Test-Path $npmYarn) {
        Write-Host '  Removing conflicting npm-global yarn v1...'
        npm uninstall -g yarn 2>&1 | Out-Null
    }

    Write-Host "  Enabling corepack (shim dir: $corepackBin)..."
    corepack enable --install-directory $corepackBin
    corepack prepare yarn@4.5.3 --activate

    if ($env:Path -notlike "*$corepackBin*") {
        $env:Path = $corepackBin + ';' + $env:Path
    }
}

$cargoPath = Join-Path $env:USERPROFILE '.cargo\bin'
if ((Test-Path $cargoPath) -and ($env:Path -notlike "*\.cargo\bin*")) {
    $env:Path = $cargoPath + ';' + $env:Path
}

# ── Preflight checks ─────────────────────────────────────────
Write-Step 'Preflight checks'
Assert-Cmd 'node'   'Install via: nvm install 20 && nvm use 20'
Assert-Cmd 'cargo'  'Install via: make setup-windows (installs Rust)'

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

# ── Download binaries (bun, uv) ──────────────────────────────
Write-Step 'yarn download:bin'
yarn download:bin
if ($LASTEXITCODE -ne 0) { Write-Host 'download:bin failed' -ForegroundColor Red; exit 1 }

# ── Download CPU-only llamacpp backend (matches CI) ───────────
Write-Step 'Download llamacpp CPU backend (win-common_cpus-x64)'
$llamacppDir = 'src-tauri/resources/llamacpp-backend'
$backend = 'win-common_cpus-x64'

if (Test-Path $llamacppDir) { Remove-Item $llamacppDir -Recurse -Force }
New-Item -ItemType Directory -Path $llamacppDir -Force | Out-Null

$apiUrl = 'https://api.github.com/repos/janhq/llama.cpp/releases/latest'
$headers = @{ 'User-Agent' = 'atomic-chat-build' }
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

Write-Host "  CPU backend ($backend) downloaded successfully" -ForegroundColor Green

# ── Build web app ─────────────────────────────────────────────
Write-Step 'yarn build:web'
yarn build:web
if ($LASTEXITCODE -ne 0) { Write-Host 'build:web failed' -ForegroundColor Red; exit 1 }

# ── Generate icons (tauri icon, skip macOS-only Python padding) ─
Write-Step 'Generating icons'
yarn tauri icon ./src-tauri/icons/icon.png
if ($LASTEXITCODE -ne 0) { Write-Host 'tauri icon failed' -ForegroundColor Red; exit 1 }

# ── Copy assets for Tauri ─────────────────────────────────────
Write-Step 'Copying assets for Tauri'
yarn copy:assets:tauri
if ($LASTEXITCODE -ne 0) { Write-Host 'copy:assets:tauri failed' -ForegroundColor Red; exit 1 }

# ── Build CLI (release) ───────────────────────────────────────
Write-Step 'Build jan-cli (release)'
if (-not (Test-Path 'src-tauri/resources/bin')) {
    New-Item -ItemType Directory -Path 'src-tauri/resources/bin' -Force | Out-Null
}

Push-Location src-tauri
cargo build --release --features cli --bin jan-cli
if ($LASTEXITCODE -ne 0) {
    Pop-Location
    Write-Host 'cargo build jan-cli failed' -ForegroundColor Red
    exit 1
}
Pop-Location

Copy-Item -Path 'src-tauri/target/release/jan-cli.exe' -Destination 'src-tauri/resources/bin/jan-cli.exe' -Force
Write-Host '  CLI built: src-tauri/resources/bin/jan-cli.exe'

# ── Build Tauri app (NSIS + MSI, no code signing) ─────────────
Write-Step 'Building Tauri app (release, unsigned)'
$env:NODE_OPTIONS = '--max-old-space-size=4196'
yarn tauri build --config src-tauri/tauri.windows.conf.json
if ($LASTEXITCODE -ne 0) {
    Write-Host 'tauri build failed' -ForegroundColor Red
    exit 1
}

# ── Done ──────────────────────────────────────────────────────
Write-Host ''
Write-Host '================================================================' -ForegroundColor Green
Write-Host '  BUILD COMPLETE!' -ForegroundColor Green
Write-Host '================================================================' -ForegroundColor Green
Write-Host ''

$nsisDir = 'src-tauri/target/release/bundle/nsis'
if (Test-Path $nsisDir) {
    Write-Host '  NSIS Installer(s):' -ForegroundColor Cyan
    Get-ChildItem -Path $nsisDir -Filter '*.exe' | ForEach-Object {
        Write-Host "    $($_.FullName)" -ForegroundColor White
    }
}

$msiDir = 'src-tauri/target/release/bundle/msi'
if (Test-Path $msiDir) {
    Write-Host '  MSI Installer(s):' -ForegroundColor Cyan
    Get-ChildItem -Path $msiDir -Filter '*.msi' | ForEach-Object {
        Write-Host "    $($_.FullName)" -ForegroundColor White
    }
}

Write-Host ''

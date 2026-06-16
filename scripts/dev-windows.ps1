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
#   -SkipBackendDownload  Reuse the llama.cpp backend already present under
#                         src-tauri/resources/llamacpp-backend-upstream
#                         (used by `make dev-windows-fast` for quick iteration).

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

function Test-BackendSatisfiedBy {
    # True when an already-downloaded concrete backend satisfies the selected
    # backend: an exact match, or a concrete CUDA minor that belongs to the
    # selected minor-less CUDA family (e.g. win-cuda-13.3-x64 satisfies
    # win-cuda-13-x64). Avoids a needless re-download on every dev run.
    param([string]$Existing, [string]$Selected)
    if (-not $Existing) { return $false }
    if ($Existing -eq $Selected) { return $true }
    if ($Selected -match '^win-cuda-(\d+)-x64$') {
        return ($Existing -match ('^win-cuda-' + $Matches[1] + '\.\d+-x64$'))
    }
    return $false
}

function Resolve-BackendFromReleases {
    # Given the parsed ggml-org/llama.cpp releases array and a selected backend
    # id, return @{ Backend; Tag } for the asset to download. A minor-less CUDA
    # family id (win-cuda-13-x64) resolves to the highest published concrete
    # minor (win-cuda-13.3-x64); any other id is matched by exact asset name.
    # Mirrors resolveCudaFamilyConcrete() in
    # extensions/llamacpp-upstream-extension/src/backend.ts.
    param([object[]]$Releases, [string]$Backend)
    if ($Backend -match '^win-cuda-(\d+)-x64$') {
        $major = $Matches[1]
        foreach ($r in $Releases) {
            if ($r.draft -or $r.prerelease) { continue }
            $assetRe = '^llama-' + [regex]::Escape($r.tag_name) + "-bin-win-cuda-$major\.(\d+)-x64\.zip$"
            $best = $null
            $bestMinor = -1
            foreach ($a in $r.assets) {
                if ($a.name -match $assetRe) {
                    $minor = [int]$Matches[1]
                    if ($minor -gt $bestMinor) {
                        $bestMinor = $minor
                        $best = "win-cuda-$major.$minor-x64"
                    }
                }
            }
            if ($best) { return [pscustomobject]@{ Backend = $best; Tag = $r.tag_name } }
        }
        return $null
    }
    foreach ($r in $Releases) {
        if ($r.draft -or $r.prerelease) { continue }
        $want = "llama-$($r.tag_name)-bin-$Backend.zip"
        if ($r.assets | Where-Object { $_.name -eq $want }) {
            return [pscustomobject]@{ Backend = $Backend; Tag = $r.tag_name }
        }
    }
    return $null
}

function Invoke-GitHubReleases {
    # Fetch the releases list with retry/backoff, mirroring the Makefile's
    # _gh_fetch (retries 403 rate-limit / 429 / 5xx). Returns the parsed array,
    # or $null when the API stays unreachable. A primary 60-req/hr rate limit
    # won't clear within the backoff window — the caller degrades to an
    # already-installed backend or an actionable GH_TOKEN hint.
    param([string]$Uri, [hashtable]$Headers)
    for ($i = 1; $i -le 5; $i++) {
        try {
            return Invoke-RestMethod -Uri $Uri -Headers $Headers -UseBasicParsing
        } catch {
            $code = $null
            $resp = $_.Exception.Response
            if ($resp) { try { $code = [int]$resp.StatusCode } catch {} }
            if ($code -in 403, 429, 500, 502, 503, 504) {
                $wait = $i * 3
                Write-Host "  GitHub API attempt $i/5: HTTP $code, retrying in ${wait}s..." -ForegroundColor Yellow
                Start-Sleep -Seconds $wait
                continue
            }
            Write-Host "  GitHub API error: $($_.Exception.Message)" -ForegroundColor Yellow
            return $null
        }
    }
    return $null
}

$nvidiaDriver = Get-NvidiaDriverVersion
$hasVulkan = Test-VulkanSupport
$cudaTier = $null

if ($nvidiaDriver) {
    Write-Host "  NVIDIA GPU detected, driver version: $nvidiaDriver" -ForegroundColor Green

    # Thresholds match src-tauri/plugins/tauri-plugin-llamacpp-upstream/src/backend.rs
    # (min_cuda13_driver = 581.15, min_cuda12_driver = 551.61). ggml-org
    # publishes CUDA 12.4 and 13.x Windows builds; CUDA 11 is no longer produced
    # upstream and is unsupported on Windows after the llamacpp-upstream
    # consolidation (ADR 2026-05-22). The concrete CUDA-13 minor (13.1 → 13.3 →
    # …) drifts release to release, so we select a minor-less *family* id here
    # and resolve the published minor from the release assets below (ATO-174).
    if ((Compare-VersionStrings $nvidiaDriver '581.15') -ge 0) {
        $cudaTier = 13
        Write-Host "  CUDA tier: 13.x (driver >= 581.15)" -ForegroundColor Green
    } elseif ((Compare-VersionStrings $nvidiaDriver '551.61') -ge 0) {
        $cudaTier = 12
        Write-Host "  CUDA tier: 12.4 (driver >= 551.61)" -ForegroundColor Green
    } else {
        Write-Host "  NVIDIA driver too old for upstream CUDA ($nvidiaDriver < 551.61)" -ForegroundColor Yellow
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

# Priority order matches prioritize_backends() in
# src-tauri/plugins/tauri-plugin-llamacpp-upstream/src/backend.rs:
#   With enough VRAM: cuda → vulkan → cpu;  without: cuda → cpu → vulkan.
# CUDA is selected as a minor-less family id (win-cuda-13-x64 / win-cuda-12-x64);
# Resolve-BackendFromReleases turns it into the highest published concrete minor.
if ($cudaTier -eq 13) {
    $backend = 'win-cuda-13-x64'
} elseif ($cudaTier -eq 12) {
    $backend = 'win-cuda-12-x64'
} elseif ($hasVulkan -and $hasEnoughVram) {
    $backend = 'win-vulkan-x64'
} else {
    $backend = 'win-cpu-x64'
}

# Allow manual override via LLAMACPP_BACKEND env var
if ($env:LLAMACPP_BACKEND) {
    Write-Host "  Overriding backend via LLAMACPP_BACKEND env var: $env:LLAMACPP_BACKEND" -ForegroundColor Cyan
    $backend = $env:LLAMACPP_BACKEND
}

Write-Host ''
Write-Host "  Selected backend: $backend" -ForegroundColor Cyan

# ── Download llamacpp backend from ggml-org/llama.cpp ─────────
# Per ADR 2026-05-22, Windows ships only the upstream provider, so the
# dev-windows backend resource dir is `llamacpp-backend-upstream/`.
Write-Step "Download upstream llamacpp backend: $backend"
$llamacppDir = 'src-tauri/resources/llamacpp-backend-upstream'
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
} elseif ((Test-Path $llamaServerExe) -and (Test-BackendSatisfiedBy $existingBackend $backend)) {
    Write-Host "  llamacpp backend ($existingBackend) already present for selection '$backend', skipping download."
    $backend = $existingBackend
    $skipDownload = $true
}

if ($skipDownload) {
    # nothing to do
} else {
    if ($SkipBackendDownload) {
        Write-Host '  -SkipBackendDownload set, but no llama-server.exe found — falling back to download.' -ForegroundColor Yellow
    }
    # ATO-95: list recent releases and pick the newest one whose asset for the
    # selected backend is ACTUALLY uploaded. ggml-org marks a fresh bXXXX tag
    # "latest" before its per-platform assets finish uploading, so trusting
    # /releases/latest then building the asset URL raced the upload and 404'd.
    $apiUrl = 'https://api.github.com/repos/ggml-org/llama.cpp/releases?per_page=20'
    $headers = @{ 'User-Agent' = 'atomic-chat-dev' }
    if ($env:GH_TOKEN) {
        $headers['Authorization'] = "Bearer $env:GH_TOKEN"
    }

    Write-Host '  Fetching recent releases...'
    $releases = Invoke-GitHubReleases -Uri $apiUrl -Headers $headers
    # Resolve a CUDA family id to the highest published concrete minor, or match
    # a concrete/cpu/vulkan id by exact asset name (ATO-174).
    $resolved = if ($releases) { Resolve-BackendFromReleases -Releases $releases -Backend $backend } else { $null }

    if ($resolved) {
        $tag = $resolved.Tag
        $backend = $resolved.Backend
        Write-Host "  Resolved backend: $backend (release $tag)"

        # Only discard a differing existing backend once a replacement is
        # confirmed — a failed/rate-limited fetch must never destroy a working
        # backend (ATO-174 follow-up).
        if ($existingBackend -and ($existingBackend -ne $backend)) {
            Write-Host "  Backend changed: $existingBackend -> $backend, re-downloading..." -ForegroundColor Yellow
            Remove-Item -Recurse -Force $llamacppDir -ErrorAction SilentlyContinue
        }
        if (-not (Test-Path $llamacppDir)) {
            New-Item -ItemType Directory -Path $llamacppDir -Force | Out-Null
        }

        # ggml-org publishes Windows binaries as .zip (not .tar.gz like the
        # legacy janhq mirror), so use Expand-Archive instead of tar.
        $archiveUrl = "https://github.com/ggml-org/llama.cpp/releases/download/$tag/llama-$tag-bin-$backend.zip"
        $archivePath = Join-Path $env:TEMP 'llamacpp-upstream-backend.zip'

        Write-Host "  Release: $tag  Backend: $backend"
        Write-Host "  Downloading: $archiveUrl"

        $downloaded = $false
        for ($i = 1; $i -le 5; $i++) {
            try {
                Invoke-WebRequest -Uri $archiveUrl -OutFile $archivePath -UseBasicParsing
                $downloaded = $true
                break
            } catch {
                Write-Host "  Download attempt $i/5 failed: $($_.Exception.Message); retrying..." -ForegroundColor Yellow
                Start-Sleep -Seconds 3
            }
        }
        if (-not $downloaded) {
            Write-Host "[FATAL] Failed to download $archiveUrl after 5 attempts" -ForegroundColor Red
            exit 1
        }

        Set-Content -Path "$llamacppDir/version.txt" -Value $tag -NoNewline
        Set-Content -Path "$llamacppDir/backend.txt" -Value $backend -NoNewline

        Write-Host '  Extracting...'
        Expand-Archive -Path $archivePath -DestinationPath $llamacppDir -Force
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

        # Merge CUDA Toolkit runtime DLLs from the matching cudart archive
        # (AtomicBot-ai/Atomic-Chat#14). No-op for non-CUDA backends.
        & (Join-Path $PSScriptRoot 'download-llamacpp-cudart-windows.ps1') `
            -BackendDir $llamacppDir -Backend $backend -Tag $tag
        if ($LASTEXITCODE -ne 0) {
            Write-Host '  cudart merge failed (continuing — GPU detection may not work)' -ForegroundColor Yellow
        }

        Write-Host "  llamacpp backend ($backend) downloaded successfully" -ForegroundColor Green
    } elseif (Test-Path $llamaServerExe) {
        # GitHub unreachable / rate-limited / asset still uploading: keep the
        # already-installed backend rather than aborting `make dev`.
        $reuse = if ($existingBackend) { $existingBackend } else { '<unknown>' }
        Write-Host "  Could not resolve a downloadable backend; reusing existing backend ($reuse) on disk." -ForegroundColor Yellow
        if ($existingBackend) { $backend = $existingBackend }
    } else {
        Write-Host "[FATAL] Could not fetch a llama.cpp backend for '$backend'." -ForegroundColor Red
        if (-not $releases) {
            Write-Host '        GitHub API was unreachable or rate-limited (unauthenticated = 60 req/hr per IP).' -ForegroundColor Red
            Write-Host '        Set a GH_TOKEN to raise the limit (5000 req/hr), then re-run:' -ForegroundColor Red
            Write-Host '          $env:GH_TOKEN = "<github_pat>"; make dev-windows' -ForegroundColor Red
        } else {
            Write-Host "        No recent release carries an asset for '$backend' (upstream upload may be in progress)." -ForegroundColor Red
        }
        exit 1
    }
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

# =============================================================================
# Atomic Chat — Windows GPU diagnostics collector
# =============================================================================
#
# Run this on a Windows host where Atomic Chat shows "No GPUs detected" or
# silently falls back to CPU inference. It collects everything we need to
# diagnose the root cause and packages it into a single .zip on the Desktop.
#
# Nothing in this script touches Atomic Chat's state — it is read-only. It
# does NOT upload anything; you decide where to send the .zip afterwards.
#
# Usage (one of):
#   1. Right-click the file -> Run with PowerShell
#   2. From PowerShell:
#        powershell -ExecutionPolicy Bypass -File .\collect-windows-gpu-diag.ps1
#
# Requirements: built-in PowerShell 5.1+ (default on Windows 10/11).
# No admin rights required.
# =============================================================================

$ErrorActionPreference = 'Continue'
$ProgressPreference    = 'SilentlyContinue'

$ts        = Get-Date -Format 'yyyy-MM-dd_HH-mm-ss'
$outDir    = Join-Path $env:TEMP "AtomicChat-GpuDiag-$ts"
$zipPath   = Join-Path ([Environment]::GetFolderPath('Desktop')) "AtomicChat-GpuDiag-$ts.zip"
$dataRoot  = Join-Path $env:APPDATA 'Atomic Chat\data'
$logRoot   = Join-Path $dataRoot 'logs'
$backRoot  = Join-Path $dataRoot 'llamacpp-upstream\backends'
$legacyBackRoot = Join-Path $dataRoot 'llamacpp\backends'

New-Item -ItemType Directory -Force -Path $outDir | Out-Null

function Write-Section($title) {
    Write-Host ''
    Write-Host ('=' * 78) -ForegroundColor Cyan
    Write-Host (" $title") -ForegroundColor Cyan
    Write-Host ('=' * 78) -ForegroundColor Cyan
}

function Save-Text($name, $text) {
    $path = Join-Path $outDir $name
    $text | Out-File -FilePath $path -Encoding utf8
}

function Try-Run($name, [scriptblock]$block) {
    try {
        & $block
    } catch {
        Save-Text "$name.error.txt" ("EXCEPTION while collecting '$name':`n" + $_.Exception.ToString())
        Write-Host "  ! '$name' threw: $($_.Exception.Message)" -ForegroundColor Yellow
    }
}

Write-Host ''
Write-Host '+--------------------------------------------------------------------------+' -ForegroundColor Green
Write-Host '|   Atomic Chat - Windows GPU diagnostics collector                        |' -ForegroundColor Green
Write-Host '|   This is read-only. Output goes to a .zip on your Desktop.              |' -ForegroundColor Green
Write-Host '+--------------------------------------------------------------------------+' -ForegroundColor Green
Write-Host ''
Write-Host "Output dir: $outDir"
Write-Host "Zip target: $zipPath"

# -----------------------------------------------------------------------------
# 1. System / Atomic Chat / Windows basics
# -----------------------------------------------------------------------------
Write-Section '1/9  System & Atomic Chat version'

Try-Run 'system-summary' {
    $atomicExe = @(
        "$env:LOCALAPPDATA\Programs\Atomic Chat\Atomic Chat.exe",
        "$env:ProgramFiles\Atomic Chat\Atomic Chat.exe",
        "${env:ProgramFiles(x86)}\Atomic Chat\Atomic Chat.exe"
    ) | Where-Object { Test-Path $_ } | Select-Object -First 1

    $atomicVer = if ($atomicExe) {
        (Get-Item $atomicExe).VersionInfo.FileVersion
    } else { '(Atomic Chat.exe not found in standard install dirs)' }

    $cs  = Get-CimInstance Win32_ComputerSystem    -ErrorAction SilentlyContinue
    $os  = Get-CimInstance Win32_OperatingSystem   -ErrorAction SilentlyContinue
    $cpu = Get-CimInstance Win32_Processor         -ErrorAction SilentlyContinue
    $gpu = Get-CimInstance Win32_VideoController   -ErrorAction SilentlyContinue

    $lines = @()
    $lines += "Collected at:        $(Get-Date -Format 'u')"
    $lines += "Atomic Chat .exe:    $atomicExe"
    $lines += "Atomic Chat version: $atomicVer"
    $lines += ''
    $lines += "OS:                  $($os.Caption) / $($os.Version) / build $($os.BuildNumber)"
    $lines += "Architecture:        $($os.OSArchitecture)"
    $lines += "Computer model:      $($cs.Manufacturer) $($cs.Model)"
    $lines += "Total RAM:           $([math]::Round($cs.TotalPhysicalMemory / 1GB, 2)) GiB"
    $lines += ''
    $lines += "CPU:                 $($cpu.Name)"
    $lines += "Cores / threads:     $($cpu.NumberOfCores) / $($cpu.NumberOfLogicalProcessors)"
    $lines += ''
    $lines += '--- Win32_VideoController (every adapter the OS sees) ---'
    foreach ($g in $gpu) {
        $lines += ''
        $lines += "  Name:            $($g.Name)"
        $lines += "  DriverVersion:   $($g.DriverVersion)"
        $lines += "  DriverDate:      $($g.DriverDate)"
        $lines += "  AdapterRAM:      $([math]::Round(($g.AdapterRAM / 1GB), 2)) GiB"
        $lines += "  VideoProcessor:  $($g.VideoProcessor)"
        $lines += "  PNPDeviceID:     $($g.PNPDeviceID)"
        $lines += "  Status:          $($g.Status)"
    }

    Save-Text 'system-summary.txt' ($lines -join "`r`n")
    Write-Host '  + system-summary.txt'
}

# -----------------------------------------------------------------------------
# 2. nvidia-smi (the ground-truth NVIDIA telemetry)
# -----------------------------------------------------------------------------
Write-Section '2/9  nvidia-smi (NVIDIA driver / GPU telemetry)'

Try-Run 'nvidia-smi' {
    $smi = Get-Command nvidia-smi -ErrorAction SilentlyContinue
    if (-not $smi) {
        Save-Text 'nvidia-smi.MISSING.txt' @'
nvidia-smi.exe was not found on PATH.

This means EITHER:
  (a) you do not have an NVIDIA GPU, OR
  (b) the NVIDIA driver is not installed / not on PATH.

If you DO have an NVIDIA GPU, please reinstall the latest NVIDIA driver
from https://www.nvidia.com/drivers and re-run this script.
'@
        Write-Host '  ! nvidia-smi not found — see nvidia-smi.MISSING.txt' -ForegroundColor Yellow
        return
    }
    & nvidia-smi              2>&1 | Out-File -FilePath (Join-Path $outDir 'nvidia-smi.txt')    -Encoding utf8
    & nvidia-smi -q           2>&1 | Out-File -FilePath (Join-Path $outDir 'nvidia-smi-q.txt')  -Encoding utf8
    & nvidia-smi -L           2>&1 | Out-File -FilePath (Join-Path $outDir 'nvidia-smi-L.txt')  -Encoding utf8
    Write-Host '  + nvidia-smi.txt, nvidia-smi-q.txt, nvidia-smi-L.txt'
}

# -----------------------------------------------------------------------------
# 3. dxdiag (DirectX / Windows graphics-stack view)
# -----------------------------------------------------------------------------
Write-Section '3/9  dxdiag (DirectX adapters & WDDM info)'

Try-Run 'dxdiag' {
    $dxFile = Join-Path $outDir 'dxdiag.txt'
    Start-Process -FilePath 'dxdiag' -ArgumentList "/whql:off /t `"$dxFile`"" -Wait -NoNewWindow
    $deadline = (Get-Date).AddSeconds(30)
    while (-not (Test-Path $dxFile) -and (Get-Date) -lt $deadline) {
        Start-Sleep -Milliseconds 500
    }
    if (Test-Path $dxFile) { Write-Host '  + dxdiag.txt' }
    else { Write-Host '  ! dxdiag did not produce a file within 30s' -ForegroundColor Yellow }
}

# -----------------------------------------------------------------------------
# 4. Inventory of installed llamacpp-upstream backends + DLLs
# -----------------------------------------------------------------------------
Write-Section '4/9  Installed llama.cpp backends (upstream + legacy)'

$installedBackends = @()

function Inventory-BackendRoot($root, $label) {
    if (-not (Test-Path $root)) {
        Save-Text "backends-$label.NONE.txt" "Path does not exist: $root"
        Write-Host "  - $label : not present"
        return
    }
    $lines = @("Backend root: $root", '')
    Get-ChildItem -Path $root -Directory -ErrorAction SilentlyContinue | ForEach-Object {
        $backendName = $_.Name
        $lines += "[$backendName]"
        Get-ChildItem -Path $_.FullName -Directory -ErrorAction SilentlyContinue | ForEach-Object {
            $version = $_.Name
            $binDir  = Join-Path $_.FullName 'build\bin'
            $exe     = Join-Path $binDir 'llama-server.exe'
            $exists  = Test-Path $exe
            $lines  += "  version: $version  llama-server.exe exists: $exists"
            if ($exists) {
                $script:installedBackends += [pscustomobject]@{
                    Root     = $root
                    Label    = $label
                    Backend  = $backendName
                    Version  = $version
                    Exe      = $exe
                    BinDir   = $binDir
                }
                # DLL inventory next to the exe
                $dlls = Get-ChildItem -Path $binDir -Filter '*.dll' -ErrorAction SilentlyContinue
                foreach ($d in $dlls) {
                    $sz = '{0,10:N0}' -f $d.Length
                    $ver = ''
                    try { $ver = $d.VersionInfo.FileVersion } catch {}
                    $lines += ('    {0} {1} {2}' -f $sz, $d.Name, $ver)
                }
            }
        }
        $lines += ''
    }
    Save-Text "backends-$label.txt" ($lines -join "`r`n")
    Write-Host "  + backends-$label.txt"
}

Try-Run 'backends-upstream' { Inventory-BackendRoot $backRoot       'upstream' }
Try-Run 'backends-legacy'   { Inventory-BackendRoot $legacyBackRoot 'legacy'   }

# -----------------------------------------------------------------------------
# 5. Run `llama-server.exe --list-devices` for each installed backend
# -----------------------------------------------------------------------------
Write-Section '5/9  llama-server.exe --list-devices (with stderr capture)'

if (-not $installedBackends -or $installedBackends.Count -eq 0) {
    Save-Text 'list-devices.NONE.txt' 'No installed backends were found, so --list-devices was not attempted.'
    Write-Host '  ! no installed backends found, skipping --list-devices'
} else {
    foreach ($b in $installedBackends) {
        $safe   = ($b.Backend + '-' + $b.Version) -replace '[^a-zA-Z0-9._-]', '_'
        $stdout = Join-Path $outDir "listdev-$safe.stdout.txt"
        $stderr = Join-Path $outDir "listdev-$safe.stderr.txt"
        $meta   = Join-Path $outDir "listdev-$safe.meta.txt"

        $env:GGML_LOG_LEVEL = 'debug'
        $proc = Start-Process -FilePath $b.Exe `
            -ArgumentList '--list-devices' `
            -WorkingDirectory $b.BinDir `
            -RedirectStandardOutput $stdout `
            -RedirectStandardError  $stderr `
            -NoNewWindow -PassThru -Wait
        Remove-Item env:GGML_LOG_LEVEL -ErrorAction SilentlyContinue

        @(
            "backend:       $($b.Backend)",
            "version:       $($b.Version)",
            "label:         $($b.Label)",
            "exe:           $($b.Exe)",
            "working dir:   $($b.BinDir)",
            "exit code:     $($proc.ExitCode)",
            "stdout bytes:  $((Get-Item $stdout -ErrorAction SilentlyContinue).Length)",
            "stderr bytes:  $((Get-Item $stderr -ErrorAction SilentlyContinue).Length)"
        ) -join "`r`n" | Out-File -FilePath $meta -Encoding utf8

        Write-Host ("  + listdev-{0,-40} exit={1}" -f $safe, $proc.ExitCode)
    }
}

# -----------------------------------------------------------------------------
# 6. Atomic Chat persisted settings (read-only copy of relevant JSONs)
# -----------------------------------------------------------------------------
Write-Section '6/9  Atomic Chat persisted settings'

Try-Run 'persisted-settings' {
    $settingsDir = Join-Path $outDir 'persisted-settings'
    New-Item -ItemType Directory -Force -Path $settingsDir | Out-Null

    if (-not (Test-Path $dataRoot)) {
        Save-Text 'persisted-settings.NONE.txt' "Data root not found: $dataRoot"
        Write-Host '  ! data root not found'
        return
    }

    $candidates = Get-ChildItem -Path $dataRoot -Recurse -ErrorAction SilentlyContinue `
        -Include 'settings.json', '*.json' |
        Where-Object {
            $_.FullName -match '\\settings\\' -or
            $_.FullName -match 'llamacpp'
        }

    foreach ($f in $candidates) {
        $rel  = $f.FullName.Substring($dataRoot.Length).TrimStart('\')
        $safe = $rel -replace '[\\/:*?"<>|]', '_'
        Copy-Item -LiteralPath $f.FullName -Destination (Join-Path $settingsDir $safe) -Force
    }

    $manifest = $candidates | ForEach-Object { $_.FullName } | Sort-Object
    Save-Text 'persisted-settings/INDEX.txt' (($manifest -join "`r`n"))
    Write-Host "  + persisted-settings/  ($($candidates.Count) files)"
}

# -----------------------------------------------------------------------------
# 7. Last few app log files
# -----------------------------------------------------------------------------
Write-Section '7/9  Recent Atomic Chat log files'

Try-Run 'app-logs' {
    if (-not (Test-Path $logRoot)) {
        Save-Text 'app-logs.NONE.txt' "Log root not found: $logRoot"
        Write-Host '  ! log root not found'
        return
    }
    $logDir = Join-Path $outDir 'logs'
    New-Item -ItemType Directory -Force -Path $logDir | Out-Null
    Get-ChildItem -Path $logRoot -File -ErrorAction SilentlyContinue |
        Sort-Object LastWriteTime -Descending |
        Select-Object -First 6 |
        ForEach-Object {
            Copy-Item -LiteralPath $_.FullName -Destination (Join-Path $logDir $_.Name) -Force
        }
    Write-Host '  + logs/  (up to 6 most recent files)'
}

# -----------------------------------------------------------------------------
# 8. PATH / CUDA / Vulkan environment
# -----------------------------------------------------------------------------
Write-Section '8/9  PATH / CUDA / Vulkan environment'

Try-Run 'environment' {
    $lines = @()
    $lines += '--- PATH (user + system, split by ; ) ---'
    $env:PATH -split ';' | ForEach-Object { $lines += $_ }
    $lines += ''
    $lines += '--- CUDA-relevant env vars ---'
    Get-ChildItem Env: | Where-Object {
        $_.Name -match 'CUDA|CUDNN|NVIDIA|GGML|VULKAN'
    } | ForEach-Object { $lines += "$($_.Name) = $($_.Value)" }
    $lines += ''
    $lines += '--- cudart64_*.dll anywhere on PATH ---'
    $env:PATH -split ';' | ForEach-Object {
        if ($_ -and (Test-Path $_)) {
            Get-ChildItem -Path $_ -Filter 'cudart64_*.dll' -ErrorAction SilentlyContinue |
                ForEach-Object { $lines += $_.FullName }
        }
    }
    $lines += ''
    $lines += '--- vulkan-1.dll anywhere on PATH or in System32 ---'
    $vkSearch = @($env:PATH -split ';') + @("$env:SystemRoot\System32", "$env:SystemRoot\SysWOW64")
    $vkSearch | ForEach-Object {
        if ($_ -and (Test-Path $_)) {
            Get-ChildItem -Path $_ -Filter 'vulkan-1.dll' -ErrorAction SilentlyContinue |
                ForEach-Object { $lines += $_.FullName }
        }
    }

    Save-Text 'environment.txt' ($lines -join "`r`n")
    Write-Host '  + environment.txt'
}

# -----------------------------------------------------------------------------
# 9. Live llama-server.exe processes (if Atomic Chat is running a model)
# -----------------------------------------------------------------------------
Write-Section '9/9  Live llama-server.exe processes (snapshot)'

Try-Run 'live-processes' {
    $procs = Get-Process llama-server -ErrorAction SilentlyContinue
    if (-not $procs) {
        Save-Text 'live-processes.txt' @'
No live llama-server.exe processes were found at the moment of collection.

If you want this diagnostic to include the DLLs llama-server actually loads
during real inference, please:
  1) Start Atomic Chat
  2) Load any model and send one message in chat
  3) WHILE the model is still loaded, re-run this script

This gives us the modules list (tasklist /m) of the running process, which
tells us which CUDA / Vulkan DLLs are actually in use during inference.
'@
        Write-Host '  - no live llama-server.exe right now'
        return
    }
    $lines = @()
    foreach ($p in $procs) {
        $lines += "PID:           $($p.Id)"
        $lines += "Path:          $($p.Path)"
        $lines += "Working set:   $([math]::Round($p.WorkingSet64 / 1MB, 1)) MiB"
        $lines += "Started:       $($p.StartTime)"
        $lines += ''
        $lines += '--- tasklist /m (loaded modules) ---'
        $lines += (tasklist /m /fi "PID eq $($p.Id)" | Out-String)
        $lines += '------------------------------------'
        $lines += ''
    }
    Save-Text 'live-processes.txt' ($lines -join "`r`n")
    Write-Host "  + live-processes.txt  ($($procs.Count) live llama-server.exe)"
}

# -----------------------------------------------------------------------------
# Package into a single .zip on the Desktop
# -----------------------------------------------------------------------------
Write-Section 'Packaging'

if (Test-Path $zipPath) { Remove-Item $zipPath -Force }
Compress-Archive -Path (Join-Path $outDir '*') -DestinationPath $zipPath -Force

Write-Host ''
Write-Host '+--------------------------------------------------------------------------+' -ForegroundColor Green
Write-Host '|   DONE.                                                                  |' -ForegroundColor Green
Write-Host '+--------------------------------------------------------------------------+' -ForegroundColor Green
Write-Host ''
Write-Host "Diagnostics zip:  $zipPath" -ForegroundColor Green
Write-Host "Staging dir:      $outDir  (you can delete it after sending the zip)"
Write-Host ''
Write-Host 'Please send the .zip to the Atomic Chat team — drop it into the GitHub'
Write-Host 'issue, Telegram support thread, or wherever you received this script.'
Write-Host ''
Write-Host 'The .zip contains NO secrets, NO chat history, NO model files — only'
Write-Host 'driver / hardware / backend metadata and a few KB of recent app logs.'
Write-Host ''

#Requires -Version 5.1
<#
.SYNOPSIS
Installs the `jan` agent CLI on Windows: either a published build from
delta.jan.ai (default) or one compiled from this checkout (-Source).

.DESCRIPTION
The PowerShell counterpart of install-jan-agent.sh. Downloaded builds
self-update via `jan update`; -Source builds do not, because the update
channel is embedded only by the nightly CI.

.EXAMPLE
.\scripts\install-jan-agent.ps1
.EXAMPLE
.\scripts\install-jan-agent.ps1 -Version 0.8.4-6 -AddToPath
.EXAMPLE
.\scripts\install-jan-agent.ps1 -Source
#>
[CmdletBinding()]
param(
  # Install directory. Defaults to $env:JAN_INSTALL_DIR, else a per-user
  # location that needs no elevation.
  [string]$Dir,
  [string]$Channel = 'agent-nightly',
  [string]$Version = '',
  [switch]$Source,
  # Append the install directory to the user PATH (persisted, not just this session).
  [switch]$AddToPath
)

$ErrorActionPreference = 'Stop'
# Speeds up Invoke-WebRequest on PowerShell 5.1 by orders of magnitude.
$ProgressPreference = 'SilentlyContinue'

$BinaryName = 'jan.exe'
$PlatformKey = 'windows-x86_64'
$RepoRoot = Split-Path -Parent (Split-Path -Parent $PSCommandPath)

if (-not $Dir) {
  if ($env:JAN_INSTALL_DIR) {
    $Dir = $env:JAN_INSTALL_DIR
  } else {
    $Dir = Join-Path $env:LOCALAPPDATA 'Programs\Jan'
  }
}

if ([Environment]::Is64BitOperatingSystem -eq $false) {
  throw 'no published build for 32-bit Windows; use -Source'
}
if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64') {
  Write-Warning 'no native ARM64 build is published; the x86_64 build runs under emulation'
}

# PowerShell 5.1 defaults to TLS 1.0, which delta.jan.ai rejects.
if ([Net.ServicePointManager]::SecurityProtocol -notmatch 'Tls12') {
  [Net.ServicePointManager]::SecurityProtocol =
    [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
}

function Install-Binary {
  param([Parameter(Mandatory)][string]$Source, [string]$Label)

  New-Item -ItemType Directory -Force -Path $Dir | Out-Null
  $dest = Join-Path $Dir $BinaryName

  # A running executable cannot be overwritten, but it can be renamed; the
  # stale copy is removed on the next install.
  $backup = "$dest.old"
  if (Test-Path -LiteralPath $backup) {
    Remove-Item -LiteralPath $backup -Force -ErrorAction SilentlyContinue
  }
  if (Test-Path -LiteralPath $dest) {
    try {
      Remove-Item -LiteralPath $dest -Force
    } catch {
      Move-Item -LiteralPath $dest -Destination $backup -Force
      Write-Warning "$BinaryName was in use; the previous copy is at $backup"
    }
  }
  Copy-Item -LiteralPath $Source -Destination $dest -Force

  if ($Label) {
    Write-Host "installed $dest ($Label)"
  } else {
    Write-Host "installed $dest"
  }

  $userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
  $onPath = ($env:Path -split ';') -contains $Dir
  if ($AddToPath) {
    if (($userPath -split ';') -notcontains $Dir) {
      $updated = if ([string]::IsNullOrEmpty($userPath)) { $Dir } else { "$userPath;$Dir" }
      [Environment]::SetEnvironmentVariable('Path', $updated, 'User')
      Write-Host "added $Dir to your user PATH; open a new terminal to pick it up"
    } else {
      Write-Host "$Dir is already on your user PATH"
    }
  } elseif (-not $onPath) {
    Write-Host "note: $Dir is not on your PATH; re-run with -AddToPath or add it yourself"
  }
}

function Install-FromSource {
  if (-not (Get-Command cargo -ErrorAction SilentlyContinue)) {
    throw 'cargo not found; install Rust first'
  }
  Write-Host "building the CLI from $RepoRoot (release)"
  Push-Location (Join-Path $RepoRoot 'src-tauri')
  try {
    # The CLI and the desktop app are mutually exclusive feature configs, so
    # the default features must stay off.
    cargo build --no-default-features --features cli --bin jan --release
    if ($LASTEXITCODE -ne 0) { throw "cargo build failed with exit code $LASTEXITCODE" }
  } finally {
    Pop-Location
  }
  $built = Join-Path $RepoRoot "src-tauri\target\release\$BinaryName"
  if (-not (Test-Path -LiteralPath $built)) { throw "expected a binary at $built" }
  Install-Binary -Source $built
  Write-Host 'note: builds from source have no update channel embedded, so `jan update` is a no-op'
}

function Install-Published {
  $base = "https://delta.jan.ai/$Channel"
  $url = ''
  $expected = ''
  $resolved = $Version

  if ($resolved) {
    $url = "$base/jan-agent-$PlatformKey-$resolved.zip"
  } else {
    Write-Host "resolving the latest $Channel build"
    try {
      $manifest = Invoke-RestMethod -Uri "$base/manifest.json" -UseBasicParsing
    } catch {
      throw "cannot fetch $base/manifest.json : $($_.Exception.Message)"
    }
    $resolved = $manifest.version
    $entry = $manifest.platforms.$PlatformKey
    if (-not $entry -or -not $entry.url) {
      throw "the $Channel manifest has no build for $PlatformKey"
    }
    $url = $entry.url
    if ($entry.PSObject.Properties.Name -contains 'sha256') { $expected = $entry.sha256 }
  }

  $tmp = Join-Path ([IO.Path]::GetTempPath()) ("jan-agent-" + [Guid]::NewGuid().ToString('N'))
  New-Item -ItemType Directory -Force -Path $tmp | Out-Null
  try {
    $archive = Join-Path $tmp 'jan-agent.zip'
    Write-Host "downloading $resolved from $url"
    try {
      Invoke-WebRequest -Uri $url -OutFile $archive -UseBasicParsing
    } catch {
      throw "download failed: $url : $($_.Exception.Message)"
    }

    if ($expected) {
      $actual = (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash
      if ($actual -ne $expected.ToUpperInvariant()) {
        throw "checksum mismatch: expected $expected, got $actual"
      }
      Write-Host 'sha256 verified'
    }

    Expand-Archive -LiteralPath $archive -DestinationPath $tmp -Force
    # Published zips keep jan.exe at the root; search anyway so a packaging
    # change cannot silently break this.
    $extracted = Get-ChildItem -Path $tmp -Recurse -File -Filter $BinaryName |
      Select-Object -First 1
    if (-not $extracted) { throw "no $BinaryName inside the archive" }

    Install-Binary -Source $extracted.FullName -Label "$Channel $resolved"
  } finally {
    Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue
  }
}

if ($Source) { Install-FromSource } else { Install-Published }

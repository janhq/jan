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
# ARCHITEW6432 is what an emulated process sees; PROCESSOR_ARCHITECTURE alone
# would report AMD64 for an x64 PowerShell on an ARM64 machine.
$NativeArch = if ($env:PROCESSOR_ARCHITEW6432) { $env:PROCESSOR_ARCHITEW6432 } else { $env:PROCESSOR_ARCHITECTURE }
# Native first, then x86_64 under emulation: it is all that pre-ARM64 versions,
# or a nightly whose ARM leg failed, have to offer.
# @() outside the `if`: PowerShell unrolls a one-element array returned from it,
# which made $PlatformKeys[0] the character 'w' and warned about emulation on x64.
$PlatformKeys = @(if ($NativeArch -eq 'ARM64') { 'windows-aarch64', 'windows-x86_64' }
                  else { 'windows-x86_64' })

if (-not $Dir) {
  if ($env:JAN_INSTALL_DIR) {
    $Dir = $env:JAN_INSTALL_DIR
  } else {
    # Same place as install-jan-agent.sh (and uv's Windows installer). Never the
    # desktop app's %LOCALAPPDATA%\Programs\Jan: its updater runs the old
    # uninstaller, which deletes that whole directory, and up to 0.8.4 the
    # desktop executable there was Jan.exe, which jan.exe would overwrite.
    $Dir = Join-Path $env:USERPROFILE '.local\bin'
  }
}
function ConvertTo-FullPath {
  param([string]$Path)
  try {
    # Resolves against PowerShell's location, not the process directory, and
    # works for paths that do not exist yet.
    $p = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($Path)
    return [IO.Path]::GetFullPath($p).TrimEnd('\')
  } catch {
    return $Path.TrimEnd('\')
  }
}

# The desktop uninstaller, which every app update runs, ends with
# `RMDir /r "$INSTDIR"`, so nothing at or under the app's directory survives,
# and that directory may not exist yet. The app installs as Jan or Jan-<channel>
# (Jan-nightly, Jan-beta); matching that segment rather than a bare `Jan*`
# keeps unrelated folders such as Programs\Janus usable.
function Test-DesktopAppDir {
  param([string]$Path)
  $full = ConvertTo-FullPath $Path
  $roots = @($env:ProgramFiles, $env:ProgramW6432)
  if ($env:LOCALAPPDATA) { $roots += Join-Path $env:LOCALAPPDATA 'Programs' }
  foreach ($root in $roots) {
    if (-not $root) { continue }
    $prefix = (ConvertTo-FullPath $root) + '\'
    if ($full.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)) {
      $segment = $full.Substring($prefix.Length).Split('\')[0]
      if ($segment -eq 'Jan' -or $segment -like 'Jan-*') { return $true }
    }
  }
  # Catches a desktop install in a custom location.
  return (Test-Path -LiteralPath (Join-Path $Path 'uninstall.exe')) -and
         (Test-Path -LiteralPath (Join-Path $Path 'resources'))
}

if (Test-DesktopAppDir $Dir) {
  throw "$Dir is (or is inside) the Jan desktop app's install directory, which is deleted on every app update; choose another -Dir"
}

if ([Environment]::Is64BitOperatingSystem -eq $false) {
  throw 'no published build for 32-bit Windows; use -Source'
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
  if ($AddToPath) {
    if (($userPath -split ';') -notcontains $Dir) {
      if (Add-ToUserPath -Key ([Microsoft.Win32.Registry]::CurrentUser) -Entry $Dir) {
        Write-Host "added $Dir to your user PATH; open a new terminal to pick it up"
      }
    } else {
      Write-Host "$Dir is already on your user PATH"
    }
  }

  # The binary can be in place and still not be what `jan` runs: a directory
  # earlier on PATH may hold another jan.exe (see Get-PathWarning).
  $warning = Get-PathWarning -Dir $Dir -Dest $dest -AddToPathRequested:$AddToPath `
    -MachinePath ([Environment]::GetEnvironmentVariable('Path', 'Machine')) `
    -UserPath ([Environment]::GetEnvironmentVariable('Path', 'User'))
  if ($warning) { Write-Warning $warning }
}

# Returns $true once Entry is appended to <Key>\Environment\Path, or $false,
# with a warning, when the value cannot be edited safely. The binary is
# already installed by then, so failing here must not abort the script.
function Add-ToUserPath {
  param([Parameter(Mandatory)][Microsoft.Win32.RegistryKey]$Key, [Parameter(Mandatory)][string]$Entry)
  $manual = "add $Entry to your user PATH yourself (System Properties > Advanced > Environment Variables)"
  try {
    # Edit the raw registry value rather than SetEnvironmentVariable, which
    # rewrites Path as REG_SZ with every %VAR% expanded (janhq/jan#9096).
    $envKey = $Key.CreateSubKey('Environment')
    try {
      $raw = $envKey.GetValue('Path', $null, 'DoNotExpandEnvironmentNames')
      $kind = if ($null -ne $raw) { $envKey.GetValueKind('Path') } else { 'ExpandString' }
      # A REG_MULTI_SZ or REG_BINARY Path is already damaged; rewriting it as a
      # string could lose whatever it holds, so leave it for the user.
      if (($kind -ne 'String' -and $kind -ne 'ExpandString') -or
          ($null -ne $raw -and $raw -isnot [string])) {
        Write-Warning "your user Path is stored as $kind rather than a string, so it was left alone; $manual"
        return $false
      }
      $updated = if ([string]::IsNullOrEmpty($raw)) { $Entry } else { "$($raw.TrimEnd(';'));$Entry" }
      $envKey.SetValue('Path', $updated, $kind)
    } finally {
      $envKey.Close()
    }
  } catch {
    Write-Warning "could not update your user Path ($($_.Exception.Message)); $manual"
    return $false
  }
  # Deleting a variable that does not exist leaves the registry alone but makes
  # .NET broadcast WM_SETTINGCHANGE, so new terminals see the new Path. It has
  # to be [NullString]::Value: PowerShell passes $null to a string parameter
  # as "", which .NET Framework treats as a delete but .NET 10 (PowerShell 7.6)
  # stores as an empty variable.
  [Environment]::SetEnvironmentVariable('JAN_INSTALL_PATH_REFRESH', [NullString]::Value, 'User')
  return $true
}

# The directory a new terminal runs `jan` from: the machine Path, then the
# user Path, each entry expanded, PATHEXT order within a directory.
function Find-JanOnPath {
  param([string]$MachinePath, [string]$UserPath)
  $exts = @(if ($env:PATHEXT) { $env:PATHEXT -split ';' | Where-Object { $_ } } else { '.COM', '.EXE', '.BAT', '.CMD' })
  $scopes = @(@{ Name = 'system'; Value = $MachinePath }, @{ Name = 'user'; Value = $UserPath })
  foreach ($scope in $scopes) {
    foreach ($entry in ("$($scope.Value)" -split ';')) {
      $d = [Environment]::ExpandEnvironmentVariables($entry.Trim().Trim('"'))
      if (-not $d) { continue }
      foreach ($ext in $exts) {
        # [IO.File]::Exists rather than Test-Path/Join-Path, which throw on a
        # missing drive or a malformed entry.
        $file = "jan$($ext.ToLowerInvariant())"
        try { $hit = [IO.File]::Exists([IO.Path]::Combine($d, $file)) } catch { $hit = $false }
        if ($hit) { return [pscustomobject]@{ Dir = $d; File = [IO.Path]::Combine($d, $file); Scope = $scope.Name } }
      }
    }
  }
  return $null
}

# A warning for when a new terminal would not run Dest as `jan`, or $null.
function Get-PathWarning {
  param([string]$Dir, [string]$Dest, [string]$MachinePath, [string]$UserPath, [switch]$AddToPathRequested)
  $target = ConvertTo-FullPath $Dir
  $listed = @("$MachinePath;$UserPath" -split ';' | Where-Object { $_.Trim() } |
    ForEach-Object { ConvertTo-FullPath ([Environment]::ExpandEnvironmentVariables($_.Trim().Trim('"'))) })
  if ($listed -notcontains $target) {
    # With -AddToPath, Add-ToUserPath has already said why it is missing.
    if ($AddToPathRequested) { return $null }
    return "$Dir is not on your PATH, so ``jan`` will not be found; re-run with -AddToPath or add it yourself"
  }
  $winner = Find-JanOnPath -MachinePath $MachinePath -UserPath $UserPath
  if (-not $winner -or (ConvertTo-FullPath $winner.Dir) -eq $target) { return $null }

  $msg = "``jan`` in a new terminal will run $($winner.File), not $Dest, because $($winner.Dir) comes earlier on your $($winner.Scope) PATH. "
  if ($winner.Dir -match '\\Programs\\Jan[^\\]*\\resources\\bin$') {
    $msg += "Jan desktop 0.8.0-0.8.4 added that entry; remove it from your PATH as described at https://jan.ai/docs/desktop/troubleshooting#jan-is-not-recognized-after-updating-the-desktop-app"
  } elseif ($winner.Dir -match '\\Programs\\Jan[^\\]*$') {
    $msg += 'An earlier version of this installer added that entry; remove it from your PATH. The jan.exe there may be the 0.8.4 desktop app itself, so do not delete files from it.'
  } else {
    $msg += 'Remove that entry from your PATH'
    $msg += if ($winner.Scope -eq 'user') { ", or move it after $Dir." } else { ' (the system PATH needs an administrator).' }
  }
  return $msg
}

function Install-FromSource {
  if (-not $PSCommandPath) {
    throw '-Source requires running the script from a checkout; download scripts\install-jan-agent.ps1 and run it from the repo'
  }
  $RepoRoot = Split-Path -Parent (Split-Path -Parent $PSCommandPath)
  if (-not (Get-Command cargo -ErrorAction SilentlyContinue)) {
    throw 'cargo not found; install Rust first'
  }
  Write-Host "building the CLI from $RepoRoot (release)"
  Push-Location (Join-Path $RepoRoot 'src-tauri\jan-cli')
  try {
    # The CLI and the desktop app are mutually exclusive feature configs, so
    # the default features must stay off.
    cargo build --no-default-features --features cli --release
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
    foreach ($k in $PlatformKeys) {
      $candidate = "$base/jan-agent-$k-$resolved.zip"
      try {
        Invoke-WebRequest -Uri $candidate -Method Head -UseBasicParsing | Out-Null
        $url = $candidate
        if ($k -ne $PlatformKeys[0]) { Write-Warning "no $($PlatformKeys[0]) build of $resolved; using $k under emulation" }
        break
      } catch { }
    }
    if (-not $url) { throw "no $Channel build of $resolved for $($PlatformKeys -join ' or ')" }
  } else {
    Write-Host "resolving the latest $Channel build"
    try {
      $manifest = Invoke-RestMethod -Uri "$base/manifest.json" -UseBasicParsing
    } catch {
      throw "cannot fetch $base/manifest.json : $($_.Exception.Message)"
    }
    $resolved = $manifest.version
    $entry = $null
    foreach ($k in $PlatformKeys) {
      $candidate = $manifest.platforms.$k
      if ($candidate -and $candidate.url) {
        $entry = $candidate
        if ($k -ne $PlatformKeys[0]) { Write-Warning "no native $($PlatformKeys[0]) build published; using $k under emulation" }
        break
      }
    }
    if (-not $entry) {
      throw "the $Channel manifest has no build for $($PlatformKeys -join ' or ')"
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

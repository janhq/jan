#!/usr/bin/env pwsh
# Windows post-test cleanup script

param(
    [string]$IsNightly = "false"
)

Write-Host "Cleaning up after tests..."

# Kill any running Jan processes (both regular and nightly)
Get-Process -Name "Jan" -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Get-Process -Name "jan" -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Get-Process -Name "Jan-nightly" -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Get-Process -Name "jan-nightly" -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue

# Remove Jan data folders (both regular and nightly)
$janAppData = "$env:APPDATA\Jan"
$janNightlyAppData = "$env:APPDATA\Jan-nightly"
$janLocalAppData = "$env:LOCALAPPDATA\jan.ai.app"
$janNightlyLocalAppData = "$env:LOCALAPPDATA\jan-nightly.ai.app"
$janProgramsPath = "$env:LOCALAPPDATA\Programs\Jan"
$janNightlyProgramsPath = "$env:LOCALAPPDATA\Programs\Jan-nightly"

if (Test-Path $janAppData) {
    Write-Host "Removing $janAppData"
    Remove-Item -Path $janAppData -Recurse -Force -ErrorAction SilentlyContinue
}

if (Test-Path $janNightlyAppData) {
    Write-Host "Removing $janNightlyAppData"
    Remove-Item -Path $janNightlyAppData -Recurse -Force -ErrorAction SilentlyContinue
}

if (Test-Path $janLocalAppData) {
    Write-Host "Removing $janLocalAppData"
    Remove-Item -Path $janLocalAppData -Recurse -Force -ErrorAction SilentlyContinue
}

if (Test-Path $janNightlyLocalAppData) {
    Write-Host "Removing $janNightlyLocalAppData"
    Remove-Item -Path $janNightlyLocalAppData -Recurse -Force -ErrorAction SilentlyContinue
}

if (Test-Path $janProgramsPath) {
    Write-Host "Removing $janProgramsPath"
    Remove-Item -Path $janProgramsPath -Recurse -Force -ErrorAction SilentlyContinue
}

if (Test-Path $janNightlyProgramsPath) {
    Write-Host "Removing $janNightlyProgramsPath"
    Remove-Item -Path $janNightlyProgramsPath -Recurse -Force -ErrorAction SilentlyContinue
}

# Remove Jan extensions folder
$janExtensionsPath = "$env:USERPROFILE\jan\extensions"
if (Test-Path $janExtensionsPath) {
    Write-Host "Removing $janExtensionsPath"
    Remove-Item -Path $janExtensionsPath -Recurse -Force -ErrorAction SilentlyContinue
}

# Try to uninstall Jan app silently
try {
    $isNightly = [System.Convert]::ToBoolean($IsNightly)

    # Determine uninstaller path based on nightly flag
    if ($isNightly) {
        $uninstallerPath = "$env:LOCALAPPDATA\Programs\jan-nightly\uninstall.exe"
        $installPath = "$env:LOCALAPPDATA\Programs\jan-nightly"
    } else {
        $uninstallerPath = "$env:LOCALAPPDATA\Programs\jan\uninstall.exe"
        $installPath = "$env:LOCALAPPDATA\Programs\jan"
    }

    Write-Host "Looking for uninstaller at: $uninstallerPath"

    if (Test-Path $uninstallerPath) {
        Write-Host "Found uninstaller, attempting silent uninstall..."
        Start-Process -FilePath $uninstallerPath -ArgumentList "/S" -Wait -NoNewWindow -ErrorAction SilentlyContinue
        Write-Host "Uninstall completed"
    } else {
        Write-Host "No uninstaller found, attempting manual cleanup..."

        if (Test-Path $installPath) {
            Write-Host "Removing installation directory: $installPath"
            Remove-Item -Path $installPath -Recurse -Force -ErrorAction SilentlyContinue
        }
    }

    Write-Host "Jan app cleanup completed"
}
catch {
    Write-Warning "Failed to uninstall Jan app cleanly: $_"
    Write-Host "Manual cleanup may be required"
}

# Clean up downloaded installer
$installerPath = "$env:TEMP\jan-installer.exe"
if (Test-Path $installerPath) {
    Remove-Item -Path $installerPath -Force -ErrorAction SilentlyContinue
}

Write-Host "Cleanup completed"

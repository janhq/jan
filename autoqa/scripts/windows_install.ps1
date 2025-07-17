#!/usr/bin/env pwsh
# Windows install script for Jan app

param(
    [string]$IsNightly = "false"
)

$installerPath = "$env:TEMP\jan-installer.exe"
$isNightly = [System.Convert]::ToBoolean($IsNightly)

Write-Host "Installing Jan app..."
Write-Host "Is nightly build: $isNightly"

# Try silent installation first
try {
    Start-Process -FilePath $installerPath -ArgumentList "/S" -Wait -NoNewWindow
    Write-Host "Jan app installed silently"
}
catch {
    Write-Host "Silent installation failed, trying normal installation..."
    Start-Process -FilePath $installerPath -Wait -NoNewWindow
}

# Wait a bit for installation to complete
Start-Sleep -Seconds 10

# Verify installation based on nightly flag
if ($isNightly) {
    $defaultJanPath = "$env:LOCALAPPDATA\Programs\jan-nightly\Jan-nightly.exe"
    $processName = "Jan-nightly.exe"
} else {
    $defaultJanPath = "$env:LOCALAPPDATA\Programs\jan\Jan.exe"
    $processName = "Jan.exe"
}

if (Test-Path $defaultJanPath) {
    Write-Host "Jan app installed successfully at: $defaultJanPath"
    Write-Output "JAN_APP_PATH=$defaultJanPath" >> $env:GITHUB_ENV
    Write-Output "JAN_PROCESS_NAME=$processName" >> $env:GITHUB_ENV
} else {
    Write-Warning "Jan app not found at expected location: $defaultJanPath"
    Write-Host "Will auto-detect during test run"
}

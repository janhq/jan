#!/usr/bin/env pwsh
# Windows cleanup script for Jan app

param(
    [string]$IsNightly = "false"
)

Write-Host "Cleaning existing Jan installations..."

# Remove Jan data folders (both regular and nightly)
$janAppData = "$env:APPDATA\Jan"
$janNightlyAppData = "$env:APPDATA\Jan-nightly"
$janLocalAppData = "$env:LOCALAPPDATA\jan.ai.app"
$janNightlyLocalAppData = "$env:LOCALAPPDATA\jan-nightly.ai.app"

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


# Kill any running Jan processes (both regular and nightly)
Get-Process -Name "Jan" -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Get-Process -Name "jan" -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Get-Process -Name "Jan-nightly" -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Get-Process -Name "jan-nightly" -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue

# Remove Jan extensions folder
$janExtensionsPath = "$env:USERPROFILE\jan\extensions"
if (Test-Path $janExtensionsPath) {
    Write-Host "Removing $janExtensionsPath"
    Remove-Item -Path $janExtensionsPath -Recurse -Force -ErrorAction SilentlyContinue
}

Write-Host "Jan cleanup completed"

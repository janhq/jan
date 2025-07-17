#!/usr/bin/env pwsh
# Windows download script for Jan app

param(
    [string]$WorkflowInputUrl = "",
    [string]$WorkflowInputIsNightly = "",
    [string]$RepoVariableUrl = "",
    [string]$RepoVariableIsNightly = "",
    [string]$DefaultUrl = "",
    [string]$DefaultIsNightly = ""
)

# Determine Jan app URL and nightly flag from multiple sources (priority order):
# 1. Workflow dispatch input (manual trigger)
# 2. Repository variable JAN_APP_URL
# 3. Default URL from env

$janAppUrl = ""
$isNightly = $false

if ($WorkflowInputUrl -ne "") {
    $janAppUrl = $WorkflowInputUrl
    $isNightly = [System.Convert]::ToBoolean($WorkflowInputIsNightly)
    Write-Host "Using Jan app URL from workflow input: $janAppUrl"
    Write-Host "Is nightly build: $isNightly"
}
elseif ($RepoVariableUrl -ne "") {
    $janAppUrl = $RepoVariableUrl
    $isNightly = [System.Convert]::ToBoolean($RepoVariableIsNightly)
    Write-Host "Using Jan app URL from repository variable: $janAppUrl"
    Write-Host "Is nightly build: $isNightly"
}
else {
    $janAppUrl = $DefaultUrl
    $isNightly = [System.Convert]::ToBoolean($DefaultIsNightly)
    Write-Host "Using default Jan app URL: $janAppUrl"
    Write-Host "Is nightly build: $isNightly"
}

# Set environment variables for later steps
Write-Output "JAN_APP_URL=$janAppUrl" >> $env:GITHUB_ENV
Write-Output "IS_NIGHTLY=$isNightly" >> $env:GITHUB_ENV

Write-Host "Downloading Jan app from: $janAppUrl"

$downloadPath = "$env:TEMP\jan-installer.exe"

try {
    # Use wget for better performance
    wget.exe "$janAppUrl" -O "$downloadPath"

    if (Test-Path $downloadPath) {
        $fileSize = (Get-Item $downloadPath).Length
        Write-Host "Downloaded Jan app successfully. Size: $fileSize bytes"
        Write-Host "File saved to: $downloadPath"
    } else {
        throw "Downloaded file not found"
    }
}
catch {
    Write-Error "Failed to download Jan app: $_"
    exit 1
}

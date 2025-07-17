#!/usr/bin/env pwsh
# Windows test runner script

param(
    [string]$JanAppPath,
    [string]$ProcessName,
    [string]$RpToken
)

Write-Host "Starting Auto QA Tests..."

Write-Host "Jan app path: $JanAppPath"
Write-Host "Process name: $ProcessName"

# Run the main test with proper arguments
if ($JanAppPath -and $ProcessName) {
    python main.py --enable-reportportal --rp-token "$RpToken" --jan-app-path "$JanAppPath" --jan-process-name "$ProcessName"
} elseif ($JanAppPath) {
    python main.py --enable-reportportal --rp-token "$RpToken" --jan-app-path "$JanAppPath"
} else {
    python main.py --enable-reportportal --rp-token "$RpToken"
}

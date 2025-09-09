# Install E2E Test Dependencies for Windows
# This script installs tauri-driver and Microsoft Edge WebDriver

Write-Host "Installing E2E test dependencies for Windows..." -ForegroundColor Green

# Basic environment check
if (-not $env:USERPROFILE) {
    Write-Host "[ERROR] USERPROFILE environment variable not set. Please restart your shell." -ForegroundColor Red
    exit 1
}

# Check if Cargo is available
try {
    cargo --version | Out-Null
    Write-Host "[SUCCESS] Cargo is available" -ForegroundColor Green
} catch {
    Write-Host "[ERROR] Cargo not found. Please install Rust first." -ForegroundColor Red
    exit 1
}

# Install tauri-driver
Write-Host "Checking tauri-driver..." -ForegroundColor Yellow
try {
    $installedVersion = & tauri-driver --version 2>&1
    Write-Host "[INFO] Current tauri-driver: $installedVersion" -ForegroundColor Cyan
    Write-Host "Updating to latest version..." -ForegroundColor Yellow
    cargo install tauri-driver --locked --force
    Write-Host "[SUCCESS] tauri-driver updated successfully" -ForegroundColor Green
} catch {
    Write-Host "[INFO] tauri-driver not found, installing..." -ForegroundColor Cyan
    try {
        cargo install tauri-driver --locked
        Write-Host "[SUCCESS] tauri-driver installed successfully" -ForegroundColor Green
    } catch {
        Write-Host "[ERROR] Failed to install tauri-driver" -ForegroundColor Red
        exit 1
    }
}

# Install msedgedriver-tool
Write-Host "Checking msedgedriver-tool..." -ForegroundColor Yellow
$msedgeDriverToolPath = Join-Path $env:USERPROFILE ".cargo\bin\msedgedriver-tool.exe"
if (Test-Path $msedgeDriverToolPath) {
    Write-Host "[INFO] msedgedriver-tool found, updating..." -ForegroundColor Cyan
    try {
        cargo install --git https://github.com/chippers/msedgedriver-tool --force
        Write-Host "[SUCCESS] msedgedriver-tool updated successfully" -ForegroundColor Green
    } catch {
        Write-Host "[ERROR] Failed to update msedgedriver-tool" -ForegroundColor Red
        exit 1
    }
} else {
    Write-Host "[INFO] msedgedriver-tool not found, installing..." -ForegroundColor Cyan
    try {
        cargo install --git https://github.com/chippers/msedgedriver-tool
        Write-Host "[SUCCESS] msedgedriver-tool installed successfully" -ForegroundColor Green
    } catch {
        Write-Host "[ERROR] Failed to install msedgedriver-tool" -ForegroundColor Red
        exit 1
    }
}

# Download Edge WebDriver using msedgedriver-tool (auto-detects version)
Write-Host "Downloading/updating Microsoft Edge WebDriver..." -ForegroundColor Yellow
try {
    $cargoPath = Join-Path $env:USERPROFILE ".cargo\bin"
    
    # Ensure cargo bin directory exists
    if (-not (Test-Path $cargoPath)) {
        Write-Host "[WARNING] Cargo bin directory not found at: $cargoPath" -ForegroundColor Yellow
        Write-Host "Creating directory..." -ForegroundColor Yellow
        New-Item -ItemType Directory -Path $cargoPath -Force | Out-Null
    }
    
    # Add to PATH if not already present
    if ($env:PATH -notlike "*$cargoPath*") {
        $env:PATH = $env:PATH + ";" + $cargoPath
    }
    
    $msedgeDriverTool = Join-Path $cargoPath "msedgedriver-tool.exe"
    
    # Check if msedgedriver-tool.exe exists
    if (-not (Test-Path $msedgeDriverTool)) {
        Write-Host "[ERROR] msedgedriver-tool.exe not found at: $msedgeDriverTool" -ForegroundColor Red
        Write-Host "Make sure the cargo install completed successfully" -ForegroundColor Yellow
        throw "msedgedriver-tool.exe not found"
    }
    
    Write-Host "Running msedgedriver-tool.exe..." -ForegroundColor Yellow
    
    # Change to cargo bin directory to ensure msedgedriver.exe downloads there
    Push-Location $cargoPath
    try {
        & $msedgeDriverTool
    } finally {
        Pop-Location
    }
    
    # Check if msedgedriver.exe was downloaded
    $msedgeDriverPath = Join-Path $cargoPath "msedgedriver.exe"
    if (Test-Path $msedgeDriverPath) {
        Write-Host "[SUCCESS] Edge WebDriver downloaded successfully to: $msedgeDriverPath" -ForegroundColor Green
    } else {
        Write-Host "[WARNING] Edge WebDriver may not have been downloaded to the expected location: $msedgeDriverPath" -ForegroundColor Yellow
        
        # Check if it was downloaded to current directory instead
        if (Test-Path ".\msedgedriver.exe") {
            Write-Host "[INFO] Found msedgedriver.exe in current directory, moving to cargo bin..." -ForegroundColor Cyan
            Move-Item ".\msedgedriver.exe" $msedgeDriverPath -Force
            Write-Host "[SUCCESS] Moved msedgedriver.exe to: $msedgeDriverPath" -ForegroundColor Green
        }
    }
} catch {
    Write-Host "[ERROR] Failed to download Edge WebDriver: $_" -ForegroundColor Red
    Write-Host "You may need to manually download msedgedriver.exe from https://developer.microsoft.com/en-us/microsoft-edge/tools/webdriver/" -ForegroundColor Yellow
    exit 1
}

# Verify installations
Write-Host "" -ForegroundColor White
Write-Host "Verifying installations..." -ForegroundColor Yellow

# Check tauri-driver - be more specific about what we're checking
$tauriDriverPath = Join-Path $cargoPath "tauri-driver.exe"
Write-Host "Checking for tauri-driver at: $tauriDriverPath" -ForegroundColor Yellow

if (Test-Path $tauriDriverPath) {
    Write-Host "[SUCCESS] tauri-driver.exe found at: $tauriDriverPath" -ForegroundColor Green
    try {
        $tauriDriverVersion = & $tauriDriverPath --version 2>&1
        Write-Host "[SUCCESS] tauri-driver version: $tauriDriverVersion" -ForegroundColor Green
    } catch {
        Write-Host "[ERROR] tauri-driver exists but failed to get version: $_" -ForegroundColor Red
    }
} else {
    Write-Host "[ERROR] tauri-driver.exe not found at expected location: $tauriDriverPath" -ForegroundColor Red
    Write-Host "Checking if it's in PATH instead..." -ForegroundColor Yellow
    try {
        $pathVersion = & tauri-driver --version 2>&1
        Write-Host "[WARNING] Found tauri-driver in PATH: $pathVersion" -ForegroundColor Yellow
        Write-Host "But this might be the wrong binary. Check 'where tauri-driver'" -ForegroundColor Yellow
    } catch {
        Write-Host "[ERROR] tauri-driver not found anywhere" -ForegroundColor Red
        exit 1
    }
}

# Check msedgedriver

$possiblePaths = @(
    (Join-Path $cargoPath "msedgedriver.exe"),
    ".\msedgedriver.exe",
    "msedgedriver.exe"
)

Write-Host "Searching for msedgedriver.exe in the following locations:" -ForegroundColor Yellow
foreach ($path in $possiblePaths) {
    Write-Host "  - $path" -ForegroundColor Yellow
}

$msedgedriverFound = $false
foreach ($path in $possiblePaths) {
    if ((Get-Command $path -ErrorAction SilentlyContinue) -or (Test-Path $path)) {
        try {
            $msedgeDriverVersion = & $path --version 2>&1
            Write-Host "[SUCCESS] msedgedriver: $msedgeDriverVersion" -ForegroundColor Green
            $msedgedriverFound = $true
            break
        } catch {
            # Continue trying other paths
        }
    }
}

if (-not $msedgedriverFound) {
    Write-Host "[ERROR] msedgedriver.exe not found or not working" -ForegroundColor Red
    Write-Host "Please ensure msedgedriver.exe is in your PATH or download it manually" -ForegroundColor Yellow
    exit 1
}

Write-Host "" -ForegroundColor White
Write-Host "Installation complete!" -ForegroundColor Green

# Show environment information for troubleshooting
Write-Host "" -ForegroundColor White
Write-Host "Environment Information:" -ForegroundColor Cyan
Write-Host "  User Profile: $env:USERPROFILE" -ForegroundColor Gray
Write-Host "  Cargo Path: $(Join-Path $env:USERPROFILE '.cargo\bin')" -ForegroundColor Gray

# Check if PATH needs to be updated permanently
if ($env:PATH -notlike "*$cargoPath*") {
    Write-Host "" -ForegroundColor White
    Write-Host "IMPORTANT: Add Cargo bin to your PATH permanently:" -ForegroundColor Yellow
    Write-Host "  1. Open System Properties > Environment Variables" -ForegroundColor Cyan
    Write-Host "  2. Add to PATH: $cargoPath" -ForegroundColor Cyan
    Write-Host "  OR run this in PowerShell as Administrator:" -ForegroundColor Cyan
    Write-Host "  [Environment]::SetEnvironmentVariable('PATH', `$env:PATH + ';$cargoPath', [EnvironmentVariableTarget]::User)" -ForegroundColor Cyan
}

Write-Host "" -ForegroundColor White
Write-Host "Run 'make e2e-build' then 'make e2e-test' to run tests" -ForegroundColor Green
Write-Host "Or use mise: 'mise run e2e-build' then 'mise run e2e-test'" -ForegroundColor Green
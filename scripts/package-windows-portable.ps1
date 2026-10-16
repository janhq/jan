param(
    [string]$ReleaseDir,
    [string]$OutputDir
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path $PSScriptRoot -Parent
$config = Get-Content -LiteralPath "$repoRoot/src-tauri/tauri.conf.json" -Raw | ConvertFrom-Json
$windows = Get-Content -LiteralPath "$repoRoot/src-tauri/tauri.windows.conf.json" -Raw | ConvertFrom-Json
if (!$ReleaseDir) {
    $targetDir = if ($env:CARGO_TARGET_DIR) { $env:CARGO_TARGET_DIR } else { "$repoRoot/src-tauri/target" }
    $ReleaseDir = Join-Path $targetDir 'release'
}
if (!$OutputDir) { $OutputDir = "$repoRoot/src-tauri/target/portable" }
$ReleaseDir = [IO.Path]::GetFullPath($ReleaseDir)
$OutputDir = [IO.Path]::GetFullPath($OutputDir)
$archiveName = "$($config.productName)_$($config.version)_x64-portable.zip"
$archivePath = Join-Path $OutputDir $archiveName
New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null
# A new staging directory prevents stale files from a previous engine variant.
$stage = Join-Path $OutputDir ([Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $stage | Out-Null

function Copy-RequiredFile([string]$Source, [string]$Destination) {
    $item = Get-Item -LiteralPath $Source
    if ($item.PSIsContainer -or $item.Length -eq 0) {
        throw "Missing or empty portable dependency: $Source"
    }
    New-Item -ItemType Directory -Force -Path (Split-Path $Destination -Parent) | Out-Null
    Copy-Item -LiteralPath $Source -Destination $Destination
}

try {
    $desktopName = "$($config.mainBinaryName).exe"
    Copy-RequiredFile (Join-Path $ReleaseDir $desktopName) (Join-Path $stage $desktopName)
    # Preserve Tauri's Windows resource paths relative to the desktop exe.
    foreach ($pattern in $windows.bundle.resources) {
        $matches = @(Get-Item -Path (Join-Path "$repoRoot/src-tauri" $pattern))
        if ($matches.Count -eq 0) { throw "No portable resource matches: $pattern" }
        foreach ($item in $matches) {
            $relative = $item.FullName.Substring(("$repoRoot/src-tauri").Length + 1)
            Copy-RequiredFile $item.FullName (Join-Path $stage $relative)
        }
    }
    # Tauri strips the Rust target suffix when bundling external binaries.
    foreach ($binary in $windows.bundle.externalBin) {
        $source = Join-Path "$repoRoot/src-tauri" "$binary-x86_64-pc-windows-msvc.exe"
        Copy-RequiredFile $source (Join-Path $stage "$(Split-Path $binary -Leaf).exe")
    }
    # Include optional SQLite acceleration and any DLLs beside the desktop exe.
    $sqlite = "$repoRoot/src-tauri/resources/bin/sqlite-vec.dll"
    if (Test-Path -LiteralPath $sqlite) {
        Copy-RequiredFile $sqlite (Join-Path $stage 'resources/bin/sqlite-vec.dll')
    }
    Get-ChildItem -LiteralPath $ReleaseDir -Filter '*.dll' -File | ForEach-Object {
        Copy-RequiredFile $_.FullName (Join-Path $stage $_.Name)
    }
    @"
Jan $($config.version) - Windows x64 portable

Extract the entire ZIP to a writable folder, then run $desktopName.
Keep resources/ and the other executables beside the desktop executable.
Microsoft Edge WebView2 Runtime and the Microsoft Visual C++ x64 runtime
must already be installed. GPU acceleration also requires a compatible driver.

This package runs without installing Jan. Settings, chats and models use
Jan's normal user data folder; they are not stored alongside this executable.
Update this package by extracting a newer ZIP, rather than using the installer
offered by the in-app updater. Models are not included.
"@ | Set-Content -LiteralPath (Join-Path $stage 'README.txt') -Encoding UTF8
    Add-Type -AssemblyName System.IO.Compression
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    # Write a new archive first, so a failed package does not replace an old ZIP.
    $temporaryArchive = "$stage.zip"
    $archive = [IO.Compression.ZipFile]::Open($temporaryArchive, [IO.Compression.ZipArchiveMode]::Create)
    try {
        # .NET Framework (Windows PowerShell 5.1) otherwise writes backslashes
        # into ZIP entry names, unlike PowerShell 7's .NET runtime.
        Get-ChildItem -LiteralPath $stage -Recurse -File -Force | ForEach-Object {
            $entryName = $_.FullName.Substring($stage.Length + 1).Replace('\', '/')
            [IO.Compression.ZipFileExtensions]::CreateEntryFromFile(
                $archive, $_.FullName, $entryName, [IO.Compression.CompressionLevel]::Optimal
            ) | Out-Null
        }
    } finally { $archive.Dispose() }
    Move-Item -LiteralPath $temporaryArchive -Destination $archivePath -Force
    if ($env:GITHUB_OUTPUT) {
        "PORTABLE_FILE_NAME=$archiveName" | Out-File -LiteralPath $env:GITHUB_OUTPUT -Encoding utf8 -Append
        "PORTABLE_PATH=$archivePath" | Out-File -LiteralPath $env:GITHUB_OUTPUT -Encoding utf8 -Append
    }
    Write-Output "Portable package: $archivePath"
} finally {
    # Only delete the newly created staging directory inside OutputDir.
    if ((Split-Path $stage -Parent).TrimEnd('\', '/') -ne $OutputDir.TrimEnd('\', '/')) {
        throw 'Invalid staging directory'
    }
    Remove-Item -LiteralPath $stage -Recurse -Force
    if (Test-Path -LiteralPath "$stage.zip") { Remove-Item -LiteralPath "$stage.zip" -Force }
}

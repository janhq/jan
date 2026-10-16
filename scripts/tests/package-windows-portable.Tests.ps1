$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$repoRoot = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$testRoot = Join-Path "$repoRoot/src-tauri/target" ('jan-portable-tests-' + [Guid]::NewGuid().ToString('N'))
$fixture = Join-Path $testRoot 'repo with spaces'
$originalTarget = $env:CARGO_TARGET_DIR
$originalOutput = $env:GITHUB_OUTPUT

function Assert-True([bool]$Condition, [string]$Message) {
    if (!$Condition) { throw $Message }
}

function Write-FixtureFile([string]$Relative, [string]$Content = 'fixture binary') {
    $destination = Join-Path $fixture $Relative
    New-Item -ItemType Directory -Force -Path (Split-Path $destination -Parent) | Out-Null
    [IO.File]::WriteAllText($destination, $Content)
}

function Assert-PackageFailure {
    $failed = $false
    try { & "$fixture/scripts/package-windows-portable.ps1" | Out-Null } catch { $failed = $true }
    Assert-True $failed 'Packaging must reject a missing or empty dependency'
}

try {
    Write-FixtureFile 'scripts/placeholder'
    Copy-Item -LiteralPath "$repoRoot/scripts/package-windows-portable.ps1" -Destination "$fixture/scripts/"
    Write-FixtureFile 'src-tauri/tauri.windows.conf.json' @'
{"bundle":{"resources":["resources/LICENSE","resources/bin/jan-llama-worker.exe","resources/bin/*.dll"],"externalBin":["resources/bin/bun","resources/bin/uv"]}}
'@
    Write-FixtureFile 'src-tauri/resources/LICENSE' 'license fixture'
    Write-FixtureFile 'src-tauri/resources/bin/jan-llama-worker.exe'
    Write-FixtureFile 'src-tauri/resources/bin/ggml-cpu.dll'
    Write-FixtureFile 'src-tauri/resources/bin/ggml-base.dll'
    Write-FixtureFile 'src-tauri/resources/bin/ggml.dll'
    Write-FixtureFile 'src-tauri/resources/bin/ggml-vulkan.dll'
    Write-FixtureFile 'src-tauri/resources/bin/sqlite-vec.dll'
    Write-FixtureFile 'src-tauri/resources/bin/bun-x86_64-pc-windows-msvc.exe' 'bun fixture'
    Write-FixtureFile 'src-tauri/resources/bin/uv-x86_64-pc-windows-msvc.exe' 'uv fixture'
    $env:CARGO_TARGET_DIR = Join-Path $fixture 'custom target'
    $env:GITHUB_OUTPUT = Join-Path $testRoot 'github-output.txt'
    foreach ($channel in @('stable', 'beta', 'nightly')) {
        $suffix = if ($channel -eq 'stable') { '' } else { "-$channel" }
        $product = "Jan$suffix"
        $desktop = "Jan-Desktop$suffix"
        Write-FixtureFile 'src-tauri/tauri.conf.json' (@{
            productName = $product; mainBinaryName = $desktop; version = '0.8.5'
        } | ConvertTo-Json)
        Write-FixtureFile "custom target/release/$desktop.exe" "desktop $channel"
        & "$fixture/scripts/package-windows-portable.ps1" | Out-Null
        $archivePath = "$fixture/src-tauri/target/portable/${product}_0.8.5_x64-portable.zip"
        $zip = [IO.Compression.ZipFile]::OpenRead($archivePath)
        try {
            foreach ($name in @("$desktop.exe", 'bun.exe', 'uv.exe', 'resources/LICENSE',
                'resources/bin/jan-llama-worker.exe', 'resources/bin/ggml-cpu.dll',
                'resources/bin/ggml-vulkan.dll', 'resources/bin/sqlite-vec.dll', 'README.txt')) {
                Assert-True ($null -ne $zip.GetEntry($name)) "Missing ZIP entry: $name"
            }
            Assert-True ($null -eq $zip.GetEntry('Jan.exe')) 'Must package the desktop executable, not a guessed CLI executable'
            $reader = New-Object IO.StreamReader($zip.GetEntry("$desktop.exe").Open())
            try { Assert-True ($reader.ReadToEnd() -eq "desktop $channel") 'Desktop bytes changed' } finally { $reader.Dispose() }
        } finally { $zip.Dispose() }
        $outputs = [IO.File]::ReadAllText($env:GITHUB_OUTPUT)
        Assert-True ($outputs.Contains("PORTABLE_FILE_NAME=${product}_0.8.5_x64-portable.zip")) 'Missing filename output'
        Assert-True ($outputs.Contains("PORTABLE_PATH=$([IO.Path]::GetFullPath($archivePath))")) 'Missing archive path output'
        Write-Output "PASS: $channel archive layout, desktop bytes and Actions outputs"
    }
    $previousHash = (Get-FileHash -LiteralPath $archivePath).Hash
    Remove-Item -LiteralPath "$fixture/src-tauri/resources/bin/uv-x86_64-pc-windows-msvc.exe"
    Assert-PackageFailure
    Write-FixtureFile 'src-tauri/resources/bin/uv-x86_64-pc-windows-msvc.exe' ''
    Assert-PackageFailure
    Assert-True ((Get-FileHash -LiteralPath $archivePath).Hash -eq $previousHash) 'Failed packaging replaced the previous ZIP'
    Write-Output 'PASS: missing/empty sidecar rejected and previous ZIP preserved'
    Write-FixtureFile 'src-tauri/resources/bin/uv-x86_64-pc-windows-msvc.exe'
    Remove-Item -LiteralPath "$fixture/src-tauri/resources/bin/ggml-vulkan.dll"
    & "$fixture/scripts/package-windows-portable.ps1" -OutputDir "$fixture/src-tauri/target/portable/" | Out-Null
    $zip = [IO.Compression.ZipFile]::OpenRead($archivePath)
    try { Assert-True ($null -eq $zip.GetEntry('resources/bin/ggml-vulkan.dll')) 'Stale backend retained from previous ZIP' } finally { $zip.Dispose() }
    Assert-True (@(Get-ChildItem -LiteralPath "$fixture/src-tauri/target/portable" -Directory).Count -eq 0) 'Staging directories were not cleaned'
    Write-Output 'PASS: archive replacement excludes stale backends and cleans staging'
} finally {
    $env:CARGO_TARGET_DIR = $originalTarget
    $env:GITHUB_OUTPUT = $originalOutput
    # This unique temporary directory is the only cleanup target.
    if ((Split-Path $testRoot -Leaf) -notlike 'jan-portable-tests-*') { throw 'Invalid test directory' }
    if (Test-Path -LiteralPath $testRoot) { Remove-Item -LiteralPath $testRoot -Recurse -Force }
}

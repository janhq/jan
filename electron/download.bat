@echo off
setlocal

:: Read the version from the version.txt file
set /p CORTEX_VERSION=<./resources/version.txt

:: Set the download URL
set DOWNLOAD_URL=https://github.com/janhq/cortex/releases/download/v%CORTEX_VERSION%/cortex-%CORTEX_VERSION%-amd64-windows.tar.gz

:: Set the output directory and file name
set OUTPUT_DIR=./resources/win
set OUTPUT_FILE=%OUTPUT_DIR%/cortex.exe

echo %OUTPUT_FILE%

:: Check if the file already exists
if exist %OUTPUT_FILE% (
    echo File %OUTPUT_FILE% already exists. Skipping download.
) else (
    echo Downloading from %DOWNLOAD_URL%
    .\node_modules\.bin\download %DOWNLOAD_URL% -e -o %OUTPUT_DIR%
)

endlocal
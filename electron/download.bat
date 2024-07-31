@echo off
set /p CORTEX_VERSION=<./resources/version.txt
set DOWNLOAD_URL=https://github.com/janhq/cortex/releases/download/v%CORTEX_VERSION%/cortex-%CORTEX_VERSION%-amd64-windows.tar.gz
echo Downloading from %DOWNLOAD_URL%

.\node_modules\.bin\download %DOWNLOAD_URL% -e -o ./resources/win
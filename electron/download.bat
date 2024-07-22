@echo off
set /p CORTEX_VERSION=<./resources/version.txt
.\node_modules\.bin\download https://github.com/janhq/cortex/releases/download/v%CORTEX_VERSION%/cortex-%CORTEX_VERSION%-amd64-windows.tar.gz -e -s 1 -o ./resources/win
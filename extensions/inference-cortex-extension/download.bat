@echo off
set BIN_PATH=./bin
set /p CORTEX_VERSION=<./bin/version.txt

@REM Download cortex.llamacpp binaries
set VERSION=v0.1.25
set DOWNLOAD_URL=https://github.com/janhq/cortex.llamacpp/releases/download/%VERSION%/cortex.llamacpp-0.1.34-windows-amd64
set SUBFOLDERS=win-cuda-12-0 win-cuda-11-7 win-noavx win-avx win-avx2 win-avx512 win-vulkan

call .\node_modules\.bin\download -e --strip 1 -o %BIN_PATH% https://github.com/janhq/cortex/releases/download/v%CORTEX_VERSION%/cortex-%CORTEX_VERSION%-windows-amd64.tar.gz
call .\node_modules\.bin\download %DOWNLOAD_URL%-avx2-cuda-12-0.tar.gz -e --strip 1 -o %BIN_PATH%/win-cuda-12-0/engines/cortex.llamacpp
call .\node_modules\.bin\download %DOWNLOAD_URL%-avx2-cuda-11-7.tar.gz -e --strip 1 -o %BIN_PATH%/win-cuda-11-7/engines/cortex.llamacpp
call .\node_modules\.bin\download %DOWNLOAD_URL%-noavx.tar.gz -e --strip 1 -o %BIN_PATH%/win-noavx/engines/cortex.llamacpp
call .\node_modules\.bin\download %DOWNLOAD_URL%-avx.tar.gz -e --strip 1 -o %BIN_PATH%/win-avx/engines/cortex.llamacpp
call .\node_modules\.bin\download %DOWNLOAD_URL%-avx2.tar.gz -e --strip 1 -o %BIN_PATH%/win-avx2/engines/cortex.llamacpp
call .\node_modules\.bin\download %DOWNLOAD_URL%-avx512.tar.gz -e --strip 1 -o %BIN_PATH%/win-avx512/engines/cortex.llamacpp
call .\node_modules\.bin\download %DOWNLOAD_URL%-vulkan.tar.gz -e --strip 1 -o %BIN_PATH%/win-vulkan/engines/cortex.llamacpp

@REM Loop through each folder and move DLLs (excluding engine.dll)
for %%F in (%SUBFOLDERS%) do (
    echo Processing folder: %BIN_PATH%\%%F

    @REM Move all .dll files except engine.dll
    for %%D in (%BIN_PATH%\%%F\engines\cortex.llamacpp\*.dll) do (
        if /I not "%%~nxD"=="engine.dll" (
            move "%%D" "%BIN_PATH%"
        )
    )
)

echo DLL files moved successfully.
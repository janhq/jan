@echo off
set BIN_PATH=./bin
set SHARED_PATH=./../../electron/shared
set /p CORTEX_VERSION=<./bin/version.txt

@REM Download cortex.llamacpp binaries
set VERSION=v0.1.35
set DOWNLOAD_URL=https://github.com/janhq/cortex.llamacpp/releases/download/%VERSION%/cortex.llamacpp-0.1.35-windows-amd64
set CUDA_DOWNLOAD_URL=https://github.com/janhq/cortex.llamacpp/releases/download/%VERSION%
set SUBFOLDERS=win-cuda-12-0 win-cuda-11-7 win-noavx win-avx win-avx2 win-avx512 win-vulkan

call .\node_modules\.bin\download -e --strip 1 -o %BIN_PATH% https://github.com/janhq/cortex/releases/download/v%CORTEX_VERSION%/cortex-%CORTEX_VERSION%-windows-amd64.tar.gz
call .\node_modules\.bin\download %DOWNLOAD_URL%-avx2-cuda-12-0.tar.gz -e --strip 1 -o %BIN_PATH%/avx2-cuda-12-0/engines/cortex.llamacpp
call .\node_modules\.bin\download %DOWNLOAD_URL%-avx2-cuda-11-7.tar.gz -e --strip 1 -o %BIN_PATH%/avx2-cuda-11-7/engines/cortex.llamacpp
call .\node_modules\.bin\download %DOWNLOAD_URL%-noavx-cuda-12-0.tar.gz -e --strip 1 -o %BIN_PATH%/noavx-cuda-12-0/engines/cortex.llamacpp
call .\node_modules\.bin\download %DOWNLOAD_URL%-noavx-cuda-11-7.tar.gz -e --strip 1 -o %BIN_PATH%/noavx-cuda-11-7/engines/cortex.llamacpp
call .\node_modules\.bin\download %DOWNLOAD_URL%-noavx.tar.gz -e --strip 1 -o %BIN_PATH%/noavx/engines/cortex.llamacpp
call .\node_modules\.bin\download %DOWNLOAD_URL%-avx.tar.gz -e --strip 1 -o %BIN_PATH%/avx/engines/cortex.llamacpp
call .\node_modules\.bin\download %DOWNLOAD_URL%-avx2.tar.gz -e --strip 1 -o %BIN_PATH%/avx2/engines/cortex.llamacpp
call .\node_modules\.bin\download %DOWNLOAD_URL%-avx512.tar.gz -e --strip 1 -o %BIN_PATH%/avx512/engines/cortex.llamacpp
call .\node_modules\.bin\download %DOWNLOAD_URL%-vulkan.tar.gz -e --strip 1 -o %BIN_PATH%/vulkan/engines/cortex.llamacpp
call .\node_modules\.bin\download %CUDA_DOWNLOAD_URL%/cuda-12-0-windows-amd64.tar.gz -e --strip 1 -o %SHARED_PATH%
call .\node_modules\.bin\download %CUDA_DOWNLOAD_URL%/cuda-11-7-windows-amd64.tar.gz -e --strip 1 -o %SHARED_PATH%

move %BIN_PATH%\cortex-server-beta.exe %BIN_PATH%\cortex-server.exe
del %BIN_PATH%\cortex-beta.exe
del %BIN_PATH%\cortex.exe

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
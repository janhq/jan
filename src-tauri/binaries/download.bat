@echo off

set CORTEX_VERSION=1.0.13-rc1
set ENGINE_VERSION=0.1.55
set ENGINE_DOWNLOAD_URL=https://github.com/menloresearch/cortex.llamacpp/releases/download/v%ENGINE_VERSION%/cortex.llamacpp-%ENGINE_VERSION%-windows-amd64
set CUDA_DOWNLOAD_URL=https://github.com/menloresearch/cortex.llamacpp/releases/download/v%ENGINE_VERSION%
@REM set SUBFOLDERS=windows-amd64-noavx-cuda-12-0 windows-amd64-noavx-cuda-11-7 windows-amd64-avx2-cuda-12-0 windows-amd64-avx2-cuda-11-7 windows-amd64-noavx windows-amd64-avx windows-amd64-avx2 windows-amd64-avx512 windows-amd64-vulkan
set BIN_PATH="./"
set DOWNLOAD_TOOL=..\..\extensions\inference-cortex-extension\node_modules\.bin\download

@REM Download cortex.llamacpp binaries

call %DOWNLOAD_TOOL% -e --strip 1 -o %BIN_PATH% https://github.com/menloresearch/cortex.cpp/releases/download/v%CORTEX_VERSION%/cortex-%CORTEX_VERSION%-windows-amd64.tar.gz
@REM call %DOWNLOAD_TOOL% %ENGINE_DOWNLOAD_URL%-avx2-cuda-12-0.tar.gz -e --strip 1 -o ./engines/cortex.llamacpp/windows-amd64-avx2-cuda-12-0/v%ENGINE_VERSION%
@REM call %DOWNLOAD_TOOL% %ENGINE_DOWNLOAD_URL%-avx2-cuda-11-7.tar.gz -e --strip 1 -o ./engines/cortex.llamacpp/windows-amd64-avx2-cuda-11-7/v%ENGINE_VERSION%
@REM call %DOWNLOAD_TOOL% %ENGINE_DOWNLOAD_URL%-noavx-cuda-12-0.tar.gz -e --strip 1 -o ./engines/cortex.llamacpp/windows-amd64-noavx-cuda-12-0/v%ENGINE_VERSION%
@REM call %DOWNLOAD_TOOL% %ENGINE_DOWNLOAD_URL%-noavx-cuda-11-7.tar.gz -e --strip 1 -o ./engines/cortex.llamacpp/windows-amd64-noavx-cuda-11-7/v%ENGINE_VERSION%
call %DOWNLOAD_TOOL% %ENGINE_DOWNLOAD_URL%-noavx.tar.gz -e --strip 1 -o ./engines/cortex.llamacpp/windows-amd64-noavx/v%ENGINE_VERSION%
call %DOWNLOAD_TOOL% %ENGINE_DOWNLOAD_URL%-avx.tar.gz -e --strip 1 -o ./engines/cortex.llamacpp/windows-amd64-avx/v%ENGINE_VERSION%
call %DOWNLOAD_TOOL% %ENGINE_DOWNLOAD_URL%-avx2.tar.gz -e --strip 1 -o ./engines/cortex.llamacpp/windows-amd64-avx2/v%ENGINE_VERSION%
call %DOWNLOAD_TOOL% %ENGINE_DOWNLOAD_URL%-avx512.tar.gz -e --strip 1 -o ./engines/cortex.llamacpp/windows-amd64-avx512/v%ENGINE_VERSION%
call %DOWNLOAD_TOOL% %ENGINE_DOWNLOAD_URL%-vulkan.tar.gz -e --strip 1 -o ./engines/cortex.llamacpp/windows-amd64-vulkan/v%ENGINE_VERSION%
@REM call %DOWNLOAD_TOOL% %CUDA_DOWNLOAD_URL%/cuda-12-0-windows-amd64.tar.gz -e --strip 1 -o %BIN_PATH%
@REM call %DOWNLOAD_TOOL% %CUDA_DOWNLOAD_URL%/cuda-11-7-windows-amd64.tar.gz -e --strip 1 -o %BIN_PATH%

move %BIN_PATH%cortex-server-beta.exe %BIN_PATH%cortex-server.exe
copy %BIN_PATH%cortex-server.exe %BIN_PATH%cortex-server-x86_64-pc-windows-msvc.exe
del %BIN_PATH%cortex-beta.exe
del %BIN_PATH%cortex.exe

@REM Loop through each folder and move DLLs (excluding engine.dll)
for %%F in (%SUBFOLDERS%) do (
    echo Processing folder: .\engines\cortex.llamacpp\%%F\v%ENGINE_VERSION%

    @REM Move all .dll files except engine.dll
    for %%D in (.\engines\cortex.llamacpp\%%F\v%ENGINE_VERSION%\*.dll) do (
        if /I not "%%~nxD"=="engine.dll" (
            move "%%D" "%BIN_PATH%"
        )
    )
)

echo DLL files moved successfully.

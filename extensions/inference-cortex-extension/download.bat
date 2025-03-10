@echo off
set BIN_PATH=./bin
set SHARED_PATH=./../../electron/shared
set /p CORTEX_VERSION=<./bin/version.txt
set ENGINE_VERSION=0.1.54

@REM Download cortex.llamacpp binaries
set DOWNLOAD_URL=https://github.com/janhq/cortex.llamacpp/releases/download/v%ENGINE_VERSION%/cortex.llamacpp-%ENGINE_VERSION%-windows-amd64
set CUDA_DOWNLOAD_URL=https://github.com/janhq/cortex.llamacpp/releases/download/v%ENGINE_VERSION%
set SUBFOLDERS=windows-amd64-noavx-cuda-12-0 windows-amd64-noavx-cuda-11-7 windows-amd64-avx2-cuda-12-0 windows-amd64-avx2-cuda-11-7 windows-amd64-noavx windows-amd64-avx windows-amd64-avx2 windows-amd64-avx512 windows-amd64-vulkan

call .\node_modules\.bin\download -e --strip 1 -o %BIN_PATH% https://github.com/janhq/cortex.cpp/releases/download/v%CORTEX_VERSION%/cortex-%CORTEX_VERSION%-windows-amd64.tar.gz
call .\node_modules\.bin\download %DOWNLOAD_URL%-avx2-cuda-12-0.tar.gz -e --strip 1 -o %SHARED_PATH%/engines/cortex.llamacpp/windows-amd64-avx2-cuda-12-0/v%ENGINE_VERSION%
call .\node_modules\.bin\download %DOWNLOAD_URL%-avx2-cuda-11-7.tar.gz -e --strip 1 -o %SHARED_PATH%/engines/cortex.llamacpp/windows-amd64-avx2-cuda-11-7/v%ENGINE_VERSION%
call .\node_modules\.bin\download %DOWNLOAD_URL%-noavx-cuda-12-0.tar.gz -e --strip 1 -o %SHARED_PATH%/engines/cortex.llamacpp/windows-amd64-noavx-cuda-12-0/v%ENGINE_VERSION%
call .\node_modules\.bin\download %DOWNLOAD_URL%-noavx-cuda-11-7.tar.gz -e --strip 1 -o %SHARED_PATH%/engines/cortex.llamacpp/windows-amd64-noavx-cuda-11-7/v%ENGINE_VERSION%
call .\node_modules\.bin\download %DOWNLOAD_URL%-noavx.tar.gz -e --strip 1 -o %SHARED_PATH%/engines/cortex.llamacpp/windows-amd64-noavx/v%ENGINE_VERSION%
call .\node_modules\.bin\download %DOWNLOAD_URL%-avx.tar.gz -e --strip 1 -o %SHARED_PATH%/engines/cortex.llamacpp/windows-amd64-avx/v%ENGINE_VERSION%
call .\node_modules\.bin\download %DOWNLOAD_URL%-avx2.tar.gz -e --strip 1 -o %SHARED_PATH%/engines/cortex.llamacpp/windows-amd64-avx2/v%ENGINE_VERSION%
call .\node_modules\.bin\download %DOWNLOAD_URL%-avx512.tar.gz -e --strip 1 -o %SHARED_PATH%/engines/cortex.llamacpp/windows-amd64-avx512/v%ENGINE_VERSION%
call .\node_modules\.bin\download %DOWNLOAD_URL%-vulkan.tar.gz -e --strip 1 -o %SHARED_PATH%/engines/cortex.llamacpp/windows-amd64-vulkan/v%ENGINE_VERSION%
call .\node_modules\.bin\download %CUDA_DOWNLOAD_URL%/cuda-12-0-windows-amd64.tar.gz -e --strip 1 -o %BIN_PATH%
call .\node_modules\.bin\download %CUDA_DOWNLOAD_URL%/cuda-11-7-windows-amd64.tar.gz -e --strip 1 -o %BIN_PATH%

move %BIN_PATH%\cortex-server-beta.exe %BIN_PATH%\cortex-server.exe
del %BIN_PATH%\cortex-beta.exe
del %BIN_PATH%\cortex.exe

@REM Loop through each folder and move DLLs (excluding engine.dll)
for %%F in (%SUBFOLDERS%) do (
    echo Processing folder: %SHARED_PATH%\engines\cortex.llamacpp\%%F\v%ENGINE_VERSION%

    @REM Move all .dll files except engine.dll
    for %%D in (%SHARED_PATH%\engines\cortex.llamacpp\%%F\v%ENGINE_VERSION%\*.dll) do (
        if /I not "%%~nxD"=="engine.dll" (
            move "%%D" "%BIN_PATH%"
        )
    )
)

echo DLL files moved successfully.

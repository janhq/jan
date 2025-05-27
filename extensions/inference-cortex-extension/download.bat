@echo off
set BIN_PATH=./bin
set SHARED_PATH=./../../electron/shared
set /p CORTEX_VERSION=<./bin/version.txt
set ENGINE_VERSION=b5509

@REM Download llama.cpp binaries
set DOWNLOAD_URL=https://github.com/menloresearch/llama.cpp/releases/download/%ENGINE_VERSION%/llama-%ENGINE_VERSION%-bin-win
set DOWNLOAD_GGML_URL=https://github.com/ggml-org/llama.cpp/releases/download/%ENGINE_VERSION%/llama-%ENGINE_VERSION%-bin-win
set CUDA_DOWNLOAD_URL=https://github.com/menloresearch/llama.cpp/releases/download/%ENGINE_VERSION%
set SUBFOLDERS=win-noavx-cuda-cu12.0-x64 win-noavx-cuda-cu11.7-x64 win-avx2-cuda-cu12.0-x64 win-avx2-cuda-cu11.7-x64 win-noavx-x64 win-avx-x64 win-avx2-x64 win-avx512-x64 win-vulkan-x64

call .\node_modules\.bin\download -e --strip 1 -o %BIN_PATH% https://github.com/menloresearch/cortex.cpp/releases/download/v%CORTEX_VERSION%/cortex-%CORTEX_VERSION%-windows-amd64.tar.gz
call .\node_modules\.bin\download %DOWNLOAD_URL%-avx2-cuda-cu12.0-x64.tar.gz -e --strip 2 -o %SHARED_PATH%/engines/llama.cpp/win-avx2-cuda-cu12.0-x64/%ENGINE_VERSION%
call .\node_modules\.bin\download %DOWNLOAD_URL%-avx2-cuda-cu11.7-x64.tar.gz -e --strip 2 -o %SHARED_PATH%/engines/llama.cpp/win-avx2-cuda-cu11.7-x64/%ENGINE_VERSION%
call .\node_modules\.bin\download %DOWNLOAD_URL%-noavx-cuda-cu12.0-x64.tar.gz -e --strip 2 -o %SHARED_PATH%/engines/llama.cpp/win-noavx-cuda-cu12.0-x64/%ENGINE_VERSION%
call .\node_modules\.bin\download %DOWNLOAD_URL%-noavx-cuda-cu11.7-x64.tar.gz -e --strip 2 -o %SHARED_PATH%/engines/llama.cpp/win-noavx-cuda-cu11.7-x64/%ENGINE_VERSION%
call .\node_modules\.bin\download %DOWNLOAD_URL%-noavx-x64.tar.gz -e --strip 2 -o %SHARED_PATH%/engines/llama.cpp/win-noavx-x64/%ENGINE_VERSION%
call .\node_modules\.bin\download %DOWNLOAD_URL%-avx-x64.tar.gz -e --strip 2 -o %SHARED_PATH%/engines/llama.cpp/win-avx-x64/%ENGINE_VERSION%
call .\node_modules\.bin\download %DOWNLOAD_URL%-avx2-x64.tar.gz -e --strip 2 -o %SHARED_PATH%/engines/llama.cpp/win-avx2-x64/%ENGINE_VERSION%
call .\node_modules\.bin\download %DOWNLOAD_URL%-avx512-x64.tar.gz -e --strip 2 -o %SHARED_PATH%/engines/llama.cpp/win-avx512-x64/%ENGINE_VERSION%
call .\node_modules\.bin\download %DOWNLOAD_GGML_URL%-vulkan-x64.zip -e --strip 1 -o %SHARED_PATH%/engines/llama.cpp/win-vulkan-x64/%ENGINE_VERSION%
call .\node_modules\.bin\download %CUDA_DOWNLOAD_URL%/cudart-llama-bin-win-cu12.0-x64.tar.gz -e --strip 1 -o %BIN_PATH%
call .\node_modules\.bin\download %CUDA_DOWNLOAD_URL%/cudart-llama-bin-win-cu11.7-x64.tar.gz -e --strip 1 -o %BIN_PATH%

move %BIN_PATH%\cortex-server-beta.exe %BIN_PATH%\cortex-server.exe
del %BIN_PATH%\cortex-beta.exe
del %BIN_PATH%\cortex.exe

@REM Loop through each folder and move DLLs
for %%F in (%SUBFOLDERS%) do (
    echo Processing folder: %SHARED_PATH%\engines\llama.cpp\%%F\%ENGINE_VERSION%

    @REM Move cu*.dll files
    for %%D in (%SHARED_PATH%\engines\llama.cpp\%%F\%ENGINE_VERSION%\cu*.dll) do (
        move "%%D" "%BIN_PATH%"        
    )
)

echo DLL files moved successfully.

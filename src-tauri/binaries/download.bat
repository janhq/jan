@echo off

set CORTEX_VERSION=1.0.14
set ENGINE_VERSION=b5509
set ENGINE_DOWNLOAD_URL=https://github.com/menloresearch/llama.cpp/releases/download/%ENGINE_VERSION%/llama-%ENGINE_VERSION%-bin-win
set ENGINE_DOWNLOAD_GGML_URL=https://github.com/ggml-org/llama.cpp/releases/download/%ENGINE_VERSION%/llama-%ENGINE_VERSION%-bin-win
set CUDA_DOWNLOAD_URL=https://github.com/menloresearch/llama.cpp/releases/download/%ENGINE_VERSION%
@REM set SUBFOLDERS=windows-amd64-noavx-cuda-12-0 windows-amd64-noavx-cuda-11-7 windows-amd64-avx2-cuda-12-0 windows-amd64-avx2-cuda-11-7 windows-amd64-noavx windows-amd64-avx windows-amd64-avx2 windows-amd64-avx512 windows-amd64-vulkan
set BIN_PATH="./"
set DOWNLOAD_TOOL=..\..\node_modules\.bin\download

@REM Download llama.cpp binaries
call %DOWNLOAD_TOOL% -e --strip 1 -o %BIN_PATH% https://github.com/menloresearch/cortex.cpp/releases/download/v%CORTEX_VERSION%/cortex-%CORTEX_VERSION%-windows-amd64.tar.gz
call %DOWNLOAD_TOOL% %ENGINE_DOWNLOAD_URL%-avx2-cuda-cu12.0-x64.tar.gz -e --strip 2 -o./engines/llama.cpp/win-avx2-cuda-cu12.0-x64/%ENGINE_VERSION%
call %DOWNLOAD_TOOL% %ENGINE_DOWNLOAD_URL%-avx2-cuda-cu11.7-x64.tar.gz -e --strip 2 -o./engines/llama.cpp/win-avx2-cuda-cu11.7-x64/%ENGINE_VERSION%
@REM call %DOWNLOAD_TOOL% %ENGINE_DOWNLOAD_URL%-noavx-cuda-cu12.0-x64.tar.gz -e --strip 2 -o./engines/llama.cpp/win-noavx-cuda-cu12.0-x64/%ENGINE_VERSION%
@REM call %DOWNLOAD_TOOL% %ENGINE_DOWNLOAD_URL%-noavx-cuda-cu11.7-x64.tar.gz -e --strip 2 -o./engines/llama.cpp/win-noavx-cuda-cu11.7-x64/%ENGINE_VERSION%
call %DOWNLOAD_TOOL% %ENGINE_DOWNLOAD_URL%-noavx-x64.tar.gz -e --strip 2 -o./engines/llama.cpp/win-noavx-x64/%ENGINE_VERSION%
call %DOWNLOAD_TOOL% %ENGINE_DOWNLOAD_URL%-avx-x64.tar.gz -e --strip 2 -o./engines/llama.cpp/win-avx-x64/%ENGINE_VERSION%
call %DOWNLOAD_TOOL% %ENGINE_DOWNLOAD_URL%-avx2-x64.tar.gz -e --strip 2 -o./engines/llama.cpp/win-avx2-x64/%ENGINE_VERSION%
call %DOWNLOAD_TOOL% %ENGINE_DOWNLOAD_URL%-avx512-x64.tar.gz -e --strip 2 -o./engines/llama.cpp/win-avx512-x64/%ENGINE_VERSION%
call %DOWNLOAD_TOOL% %ENGINE_DOWNLOAD_GGML_URL%-vulkan-x64.zip -e --strip 1 -o./engines/llama.cpp/win-vulkan-x64/%ENGINE_VERSION%
call %DOWNLOAD_TOOL% %CUDA_DOWNLOAD_URL%/cudart-llama-bin-win-cu12.0-x64.tar.gz -e --strip 1 -o %BIN_PATH%
@REM Should not bundle cuda11, users should install it themselves, it bloats the app size a lot
@REM call %DOWNLOAD_TOOL% %CUDA_DOWNLOAD_URL%/cudart-llama-bin-win-cu11.7-x64.tar.gz -e --strip 1 -o %BIN_PATH%

move %BIN_PATH%cortex-server-beta.exe %BIN_PATH%cortex-server.exe
copy %BIN_PATH%cortex-server.exe %BIN_PATH%cortex-server-x86_64-pc-windows-msvc.exe
del %BIN_PATH%cortex-beta.exe
del %BIN_PATH%cortex.exe

@REM Loop through each folder and move DLLs
for %%F in (%SUBFOLDERS%) do (
    echo Processing folder: .\engines\llama.cpp\%%F\%ENGINE_VERSION%

    @REM Move cu*.dll files
    for %%D in (.\engines\engines\llama.cpp\%%F\%ENGINE_VERSION%\cu*.dll) do (
        move "%%D" "%BIN_PATH%"        
    )
)

echo DLL files moved successfully.

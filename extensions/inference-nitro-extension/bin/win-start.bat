@echo off
setlocal enabledelayedexpansion

set "maxMemory=0"
set "gpuId="

rem check if nvidia-smi command exist or not
where nvidia-smi >nul 2>&1
if %errorlevel% neq 0 (
    echo nvidia-smi not found, proceeding with CPU version...
    cd win-cuda
    goto RunCpuVersion
)

set "tempFile=%temp%\nvidia_smi_output.txt"
nvidia-smi --query-gpu=index,memory.total --format=csv,noheader,nounits > "%tempFile%"

for /f "usebackq tokens=1-2 delims=, " %%a in ("%tempFile%") do (
    set /a memorySize=%%b
    if !memorySize! gtr !maxMemory! (
        set "maxMemory=!memorySize!"
        set "gpuId=%%a"
    )
)

rem Echo the selected GPU
echo Selected GPU: !gpuId!

rem Set the GPU with the highest VRAM as the visible CUDA device
set CUDA_VISIBLE_DEVICES=!gpuId!

rem Attempt to run nitro_windows_amd64_cuda.exe
cd win-cuda

nitro.exe %* > output.log
type output.log | findstr /C:"CUDA error" >nul
if %errorlevel% equ 0 ( goto :RunCpuVersion ) else ( goto :End )

:RunCpuVersion
rem Run nitro_windows_amd64.exe...
cd ..\win-cpu
nitro.exe %*

:End
endlocal

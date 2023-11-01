@echo off

rem Attempt to run nitro_windows_amd64_cuda.exe
cd win-cuda
nitro.exe

rem Check the exit code of the previous command
if %errorlevel% neq 0 (
    echo nitro_windows_amd64_cuda.exe encountered an error, attempting to run nitro_windows_amd64.exe...
    cd ..\win-cpu
    nitro.exe
)

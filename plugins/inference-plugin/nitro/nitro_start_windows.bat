@echo off

rem Attempt to run nitro_windows_amd64_cuda.exe
nitro_windows_amd64_cuda.exe

rem Check the exit code of the previous command
if %errorlevel% neq 0 (
    echo nitro_windows_amd64_cuda.exe encountered an error, attempting to run nitro_windows_amd64.exe...
    nitro_windows_amd64.exe
)

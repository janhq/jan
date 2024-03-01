# Note for using Jan with TensorRT-LLM on windows

There are 3 ways:

1. Using Windows docker
2. Using portable Anaconda runtime
3. Using compiled C++ code

## 1. Using Windows docker

- References
  - https://github.com/NVIDIA/TensorRT-LLM/blob/main/windows/README.md#building-from-source
  - https://github.com/NVIDIA/TensorRT-LLM/blob/main/windows/docker/Dockerfile
- Checklist

  - [x] Python runtime `tensorrt_llm`
  - [x] Example for `tensorrt_llm` with `openai api`
  - [ ] Build from source in Docker for C++ headers - [Link](https://github.com/NVIDIA/TensorRT-LLM/blob/main/windows/README.md#extra-steps-for-c-runtime-usage)

- Steps:
  - Download this folder https://drive.google.com/drive/folders/1BTSM_Sm2BgJBTPv_LRwMsHPfB87vkK4t?usp=sharing for `.exe`/ `.msi` files for installation. This saves time and also guarantees the docker build reliability
  - Verify the Dockerfile (in the folder)

```docker
# https://learn.microsoft.com/en-us/visualstudio/install/build-tools-container?view=vs-2022

# Use the Windows Server Core 2019 image.
FROM mcr.microsoft.com/windows/servercore:ltsc2019

# Restore the default Windows shell for correct batch processing.
# (Used for VS Build Tools installation)
SHELL ["cmd", "/S", "/C"]

# -----------------------------------------------------------------------------

# -----------------------------------------------------------------------------
# Install CUDA 12.2
COPY cuda_12.2.2_537.13_windows.exe cuda_installer.exe
RUN powershell -Command \
    $ErrorActionPreference = 'Stop'; \
    # Invoke-WebRequest -Uri https://developer.download.nvidia.com/compute/cuda/12.2.2/local_installers/cuda_12.2.2_537.13_windows.exe \
    # -OutFile "cuda_installer.exe"; \
    Start-Process cuda_installer.exe -Wait -ArgumentList '-s'; \
    Remove-Item cuda_installer.exe -Force
# -----------------------------------------------------------------------------

# Install Python 3.10.11
# Download and install Python
COPY python-3.10.11-amd64.exe python-3.10.11.exe

RUN powershell -Command \
    $ErrorActionPreference = 'Stop'; \
    # Invoke-WebRequest -Uri https://www.python.org/ftp/python/3.10.11/python-3.10.11-amd64.exe -OutFile python-3.10.11.exe ; \
    Start-Process python-3.10.11.exe -Wait -ArgumentList '/quiet InstallAllUsers=1 PrependPath=1' ; \
    Remove-Item python-3.10.11.exe -Force

# Add python3 command
RUN powershell -Command \
    cp "\"C:\\\\Program Files\\\\Python310\\\\python.exe\" \"C:\\\\Program Files\\\\Python310\\\\python3.exe\""

# -----------------------------------------------------------------------------

# Install Microsoft MPI

# The latest version is 10.1.3, but it requires you to get a temporary download
# link.
# https://learn.microsoft.com/en-us/message-passing-interface/microsoft-mpi-release-notes
# We use 10.1.1 which has a release on the GitHub page
COPY msmpisetup.exe msmpisetup.exe

RUN powershell -Command \
    $ErrorActionPreference = 'Stop'; \
    # Invoke-WebRequest -Uri https://github.com/microsoft/Microsoft-MPI/releases/download/v10.1.1/msmpisetup.exe \
    # -OutFile "msmpisetup.exe"; \
    Start-Process .\msmpisetup.exe -Wait ; \
    Remove-Item msmpisetup.exe -Force

# Add MPI binaries to Path
RUN setx Path "%Path%;C:\Program Files\Microsoft MPI\Bin"

COPY msmpisdk.msi msmpisdk.msi
# Download the MSMPI SDK
RUN powershell -Command \
    $ErrorActionPreference = 'Stop'; \
    # Invoke-WebRequest -Uri https://github.com/microsoft/Microsoft-MPI/releases/download/v10.1.1/msmpisdk.msi \
    # -OutFile "msmpisdk.msi"; \
    Start-Process msiexec.exe -Wait -ArgumentList '/I msmpisdk.msi /quiet'; \
    Remove-Item msmpisdk.msi -Force

# -----------------------------------------------------------------------------

# Install CMake
COPY cmake-3.27.7-windows-x86_64.msi cmake.msi
RUN powershell -Command \
    $ErrorActionPreference = 'Stop'; \
    # Invoke-WebRequest -Uri https://github.com/Kitware/CMake/releases/download/v3.27.7/cmake-3.27.7-windows-x86_64.msi \
    # -OutFile "cmake.msi"; \
    Start-Process msiexec.exe -Wait -ArgumentList '/I cmake.msi /quiet'; \
    Remove-Item cmake.msi -Force

# Add CMake binaries to Path
RUN setx Path "%Path%;C:\Program Files\CMake\bin"

# -----------------------------------------------------------------------------

# Install VS Build Tools
COPY vs_BuildTools.exe vs_buildtools.exe
RUN \
    # Download the Build Tools bootstrapper.
    # curl -SL --output vs_buildtools.exe https://aka.ms/vs/17/release/vs_buildtools.exe && \
    # \
    # Install Build Tools with the Microsoft.VisualStudio.Workload.AzureBuildTools workload, excluding workloads and components with known issues.
    (start /w vs_buildtools.exe --quiet --wait --norestart --nocache \
        --installPath "%ProgramFiles(x86)%\Microsoft Visual Studio\2022\BuildTools" \
        --includeRecommended \
        --add Microsoft.VisualStudio.Workload.MSBuildTools \
        --add Microsoft.VisualStudio.Workload.VCTools \
        --remove Microsoft.VisualStudio.Component.Windows10SDK.10240 \
        --remove Microsoft.VisualStudio.Component.Windows10SDK.10586 \
        --remove Microsoft.VisualStudio.Component.Windows10SDK.14393 \
        --remove Microsoft.VisualStudio.Component.Windows81SDK \
        || IF "%ERRORLEVEL%"=="3010" EXIT 0) \
    \
    # Cleanup
    && del /q vs_buildtools.exe

# -----------------------------------------------------------------------------

# Install Chocolatey
# Chocolatey is a package manager for Windows
# I probably could've used it to install some of the above, but I didn't...

# If you try to install Chocolatey 2.0.0, it fails on .NET Framework 4.8 installation
# https://stackoverflow.com/a/76470753
ENV chocolateyVersion=1.4.0

# https://docs.chocolatey.org/en-us/choco/setup#install-with-cmd.exe
RUN powershell -Command \
    $ErrorActionPreference = 'Stop'; \
    powershell.exe -NoProfile -InputFormat None -ExecutionPolicy Bypass \
    -Command "[System.Net.ServicePointManager]::SecurityProtocol = 3072; \
    iex ((New-Object System.Net.WebClient).DownloadString('https://community.chocolatey.org/install.ps1'))" && \
    SET "PATH=%PATH%;%ALLUSERSPROFILE%\chocolatey\bin"

# -----------------------------------------------------------------------------

# Install Git via Chocolatey
RUN powershell -Command \
    choco install git -y

COPY ["NvToolsExt", "C:\\\\Program Files\\\\NVIDIA Corporation\\\\NvToolsExt"]

# -----------------------------------------------------------------------------

# Create a working directory
WORKDIR "C:\\\\workspace"

# -----------------------------------------------------------------------------
# CuDNN 9.0.0
COPY cudnn-windows-x86_64-8.9.7.29_cuda12-archive.zip cudnn.zip
RUN powershell -Command \
    $ErrorActionPreference = 'Stop'; \
    # Invoke-WebRequest -Uri https://developer.nvidia.com/downloads/compute/machine-learning/tensorrt/9.2.0/tensorrt-9.2.0.5.windows10.x86_64.cuda-12.2.llm.beta.zip \
    # -OutFile TensorRT-9.2.0.5.zip; \
    Expand-Archive .\cudnn.zip -DestinationPath .; \
    Remove-Item cudnn.zip -Force

# Add cuDNN libs and bin to Path.
RUN setx Path "%Path%;C:\workspace\cudnn-windows-x86_64-8.9.7.29_cuda12-archive\lib\x64;C:\workspace\cudnn-windows-x86_64-8.9.7.29_cuda12-archive\bin;"

# -----------------------------------------------------------------------------

# Download and unzip TensorrRT 9.2.0.5 for TensorRT-LLM
COPY TensorRT-9.2.0.5.Windows10.x86_64.cuda-12.2.llm.beta.zip TensorRT-9.2.0.5.zip
RUN powershell -Command \
    $ErrorActionPreference = 'Stop'; \
    # Invoke-WebRequest -Uri https://developer.nvidia.com/downloads/compute/machine-learning/tensorrt/9.2.0/tensorrt-9.2.0.5.windows10.x86_64.cuda-12.2.llm.beta.zip \
    # -OutFile TensorRT-9.2.0.5.zip; \
    Expand-Archive .\TensorRT-9.2.0.5.zip -DestinationPath .; \
    Remove-Item TensorRT-9.2.0.5.zip -Force

# Add TensorRT libs to Path
RUN setx Path "%Path%;C:\workspace\TensorRT-9.2.0.5\lib"

# Install TensorRT Python wheel
RUN powershell -Command \
    $ErrorActionPreference = 'Stop'; \
    pip install TensorRT-9.2.0.5\python\tensorrt-9.2.0.post12.dev5-cp310-none-win_amd64.whl

# Install TensorRT-RT Python wheel
RUN powershell -Command \
    $ErrorActionPreference = 'Stop'; \
    git clone https://github.com/NVIDIA/TensorRT-LLM.git \
    && cd TensorRT-LLM \
    && git submodule update --init --recursive

# RUN powershell -Command \
#     $ErrorActionPreference = 'Stop'; \
#     pip install tensorrt_llm --extra-index-url https://pypi.nvidia.com --extra-index-url https://download.pytorch.org/whl/cu121

RUN powershell -Command \
    $ErrorActionPreference = 'Stop'; \
    git clone https://github.com/NVIDIA/trt-llm-as-openai-windows \
    && cd trt-llm-as-openai-windows \
    && pip install -r requirements.txt

# -----------------------------------------------------------------------------

# Define the entry point for the docker container.
# This entry point launches the 64-bit PowerShell developer shell.
# We need to launch with amd64 arch otherwise Powershell defaults to x86 32-bit build commands which don't jive with CUDA
ENTRYPOINT ["C:\\Program Files (x86)\\Microsoft Visual Studio\\2022\\BuildTools\\Common7\\Tools\\VsDevCmd.bat", "-arch=amd64", "&&", "powershell.exe", "-NoLogo", "-ExecutionPolicy", "Bypass"]
```

- Run `docker build -t windows_tensorrt_llm .`
- Run `docker run -p 8080:8080 -it -m 12g windows_tensorrt_llm`
- Run `pip install tensorrt_llm==0.6.1 --extra-index-url https://pypi.nvidia.com/ --extra-index-url https://download.pytorch.org/wh
l/cu121` inside docker runtime (This is because of the fact that the installation requires CUDA usage but Docker do not allow device passthrough in `docker build` step, only in `docker run` step)
- Verify the installation by running `python -c "import tensorrt_llm; print(tensorrt_llm._utils.trt_version())"` and verify it is installed successfully
- Given the reference at https://github.com/NVIDIA/trt-llm-as-openai-windows?tab=readme-ov-file
  - Download `Mistral 7B` model from https://huggingface.co/mistralai/Mistral-7B-v0.1/tree/main
  - Download checkpoint from https://catalog.ngc.nvidia.com/orgs/nvidia/models/mistral-7b-int4-chat/files
  - Run the BUILD model engine step with 1-GPU within the `C:\workspace\TensorRT-LLM` in the container: `python build.py --model_dir <path to Mistral model> --quant_ckpt_path <path to Mistral .npz file> --dtype float16 --use_gpt_attention_plugin float16 --use_gemm_plugin float16 --use_weight_only --weight_only_precision int4_awq --per_group --enable_context_fmha --max_batch_size 1 --max_input_len 3500 --max_output_len 1024 --output_dir <TRT engine folder>`
  - Run the application `python app.py --trt_engine_path <TRT Engine folder> --trt_engine_name <TRT Engine file>.engine --tokenizer_dir_path <tokernizer folder> --port 8080`

## 2. Using portable Anaconda runtime

## 3. Using compiled C++ code

---
title: Overview
description: Jan is a ChatGPT-alternative that runs on your own computer, with a local API server.
keywords: [Jan, ChatGPT alternative, on-premises AI, local API server, local AI, llm, conversational AI, no-subscription fee]
---

Getting up and running open-source AI models on your own computer with Jan is quick and easy. Jan is lightweight and can run on a variety of hardware and platform versions. Specific requirements tailored to your platform are outlined below.

## Cross platform
A free, open-source alternative to OpenAI that runs on the Linux, macOS, and Windows operating systems. Please refer to the specific guides below for your platform
- [Linux](/install/linux)
- [MacOS (Mac Intel Chip and Mac Apple Silicon Chip)](/install/mac)
- [Windows](/install/windows)

## Requirements for Jan

### Hardware
Jan is a lightweight platform designed for seamless download, storage, and execution of open-source Large Language Models (LLMs). With a small download size of less than 200 MB and a disk footprint of under 300 MB, Jan is optimized for efficiency and should run smoothly on modern hardware.

To ensure optimal performance while using Jan and handling LLM models, it is recommended to meet the following system requirements:

#### Disk space
- Minimum requirement
    - At least 5 GB of free disk space is required to accommodate the download, storage, and management of open-source LLM models.
- Recommended
    - For an optimal experience and to run most available open-source LLM models on Jan, it is recommended to have 10 GB of free disk space.

#### Random Access Memory (RAM) and Graphics Processing Unit Video Random Access Memory (GPU VRAM)
The amount of RAM on your system plays a crucial role in determining the size and complexity of LLM models you can effectively run. Jan can be utilized on traditional computers where RAM is a key resource. For enhanced performance, Jan also supports GPU acceleration, utilizing the VRAM of your graphics card. 

#### Relationship between RAM and VRAM Sizes in Relation to LLM Models
The RAM and GPU VRAM requirements are dependent on the size and complexity of the LLM models you intend to run. The following are some general guidelines to help you determine the amount of RAM or VRAM you need to run LLM models on Jan
- 8 GB of RAM: Suitable for running smaller models like 3B models or quantized 7B models
- 16 GB of RAM(recommended): This is considered the "minimum usable models" threshold, particularly for 7B models (e.g Mistral 7B, etc)
- Beyond 16GB of RAM: Required for handling larger and more sophisticated model, such as 70B models.

### Architecture 
Jan is designed to run on muptiple architectures, versatility and widespread usability. The supported architectures include:
#### CPU
- x86: Jan is well-suited for systems with x86 architecture, which is commonly found in traditional desktops and laptops. It ensures smooth performance on a variety of devices using x86 processors.
- ARM: Jan is optimized to run efficiently on ARM-based systems, extending compatibility to a broad range of devices using ARM processors.
#### GPU
- NVIDIA: Jan optimizes the computational capabilities of NVIDIA GPUs, achieving efficiency through the utilization of llama.cpp. This strategic integration enhances the performance of Jan, particularly in resource-intensive Language Model (LLM) tasks. Users can expect accelerated processing and improved responsiveness when leveraging the processing capabilities inherent in NVIDIA GPUs.
- AMD: Users with AMD GPUs can seamlessly integrate Jan's GPU acceleration, offering a comprehensive solution for diverse hardware configurations and preferences.
- ARM64 Mac: Jan seamlessly supports ARM64 architecture on Mac systems, leveraging Metal for efficient GPU operations. This ensures a smooth and efficient experience for users with Apple Silicon Chips, utilizing the power of Metal for optimal performance on ARM64 Mac devices.

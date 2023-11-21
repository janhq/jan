---
title: Linux
---

# Installing Jan on Linux

## Installation

### Step 1: Download the Installer
To begin using 👋Jan.ai on your Windows computer, follow these steps:

1. Visit [Jan.ai](https://jan.ai/).
2. Click on the "Download for Windows" button to download the Jan Installer.

![Jan Installer](/img/jan-download.png)

:::tip

For faster results, you should enable your NVIDIA GPU. Make sure to have the CUDA toolkit installed. You can download it from your Linux distro's package manager or from here: [CUDA Toolkit](https://developer.nvidia.com/cuda-downloads).

:::

```bash
apt install nvidia-cuda-toolkit
```

Check the installation by

```bash
nvidia-smi
```

:::tip

For AMD GPU. You can download it from your Linux distro's package manager or from here: [ROCm Quick Start (Linux)](https://rocm.docs.amd.com/en/latest/deploy/linux/quick_start.html).

:::

### Step 2: Download your first model
Now, let's get your first model:

1. After installation, you'll find the 👋Jan application icon on your desktop. Double-click to open it.

2. Welcome to the Jan homepage. Click on "Explore Models" to see the Model catalog.

![Explore models](/img/explore-model.png)

3. You can also see different quantized versions by clicking on "Show Available Versions."

![Model versions](/img/model-version.png)

> Note: Choose a model that matches your computer's memory and RAM.

4. Select your preferred model and click "Download."

![Downloading](/img/downloading.png)

### Step 3: Start the model
Once your model is downloaded. Go to "My Models" and then click "Start Model."

![Start model](/img/start-model.png)


### Step 4: Start the conversations
Now you're ready to start using 👋Jan.ai for conversations:

Click "Chat" and begin your first conversation by selecting "New conversation."

You can also check the CPU and Memory usage of the computer.

![Chat](/img/chat.png)

That's it! Enjoy using Large Language Models (LLMs) with 👋Jan.ai.

## Uninstallation

## Troubleshooting
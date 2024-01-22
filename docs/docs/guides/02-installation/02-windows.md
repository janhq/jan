---
title: Windows
slug: /install/windows
description: Jan is a ChatGPT-alternative that runs on your own computer, with a local API server.
keywords:
  [
    Jan AI,
    Jan,
    ChatGPT alternative,
    local AI,
    private AI,
    conversational AI,
    no-subscription fee,
    large language model,
    installation guide,
  ]
---

# Installing Jan on Windows

## System Requirements

Ensure that your system meets the following requirements:

- Windows 10 or higher is required to run Jan.

To enable GPU support, you will need:

- NVIDIA GPU with CUDA Toolkit 11.7 or higher
- NVIDIA driver 470.63.01 or higher

## Installation

Jan is available for download via our homepage, [https://jan.ai](https://jan.ai/).

For Windows, the download should be available as a `.exe` file in the following format.

```bash
jan-win-x64-{version}.exe
```

The typical installation process takes around a minute.

### GitHub Releases

Jan is also available from [Jan's GitHub Releases](https://github.com/janhq/jan/releases) page, with a recommended [latest stable release](https://github.com/janhq/jan/releases/latest).

Within the Releases' assets, you will find the following files for Windows:

```bash
# Windows Installers
jan-win-x64-{version}.exe
```

### Default Installation Directory

By default, Jan is installed in the following directory:

```bash
# Default installation directory
C:\Users\{username}\AppData\Local\Programs\Jan
```

## Uninstalling Jan

To uninstall Jan on Windows, use the [Windows Control Panel](https://support.microsoft.com/en-us/windows/uninstall-or-remove-apps-and-programs-in-windows-4b55f974-2cc6-2d2b-d092-5905080eaf98).

To remove all user data associated with Jan, you can delete the `/jan` directory in Windows' [AppData directory](https://superuser.com/questions/632891/what-is-appdata).

```bash
cd C:\Users\%USERNAME%\AppData\Roaming
rmdir /S jan
```

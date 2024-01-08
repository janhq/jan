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
  ]
---

# Installing Jan on Windows

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

## Troubleshooting

### Microsoft Defender

**Error: "Microsoft Defender SmartScreen prevented an unrecognized app from starting"**

Windows Defender may display the above warning when running the Jan Installer, as a standard security measure.

To proceed, select the "More info" option and select the "Run Anyway" option to continue with the installation.

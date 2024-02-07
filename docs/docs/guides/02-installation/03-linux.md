---
title: Linux
slug: /install/linux
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

# Installing Jan on Linux

## System Requirements

Ensure that your system meets the following requirements:

- glibc 2.27 or higher (check with `ldd --version`)
- gcc 11, g++ 11, cpp 11, or higher, refer to this [link](https://jan.ai/guides/troubleshooting/gpu-not-used/#specific-requirements-for-linux) for more information.

To enable GPU support, you will need:

- NVIDIA GPU with CUDA Toolkit 11.7 or higher
- NVIDIA driver 470.63.01 or higher

## Installation

Jan is available for download via our homepage, [https://jan.ai](https://jan.ai/).

For Linux, the download should be available as a `.AppImage` file or a `.deb` file in the following format.

```bash
# AppImage
jan-linux-x86_64-{version}.AppImage

# Debian Linux distribution
jan-linux-amd64-{version}.deb
```

To install Jan on Linux, you should use your package manager's install or `dpkg``. For Debian/Ubuntu-based distributions, you can install Jan using the following command:

```bash
# Install Jan using dpkg
sudo dpkg -i jan-linux-amd64-{version}.deb

# Install Jan using apt-get
sudo apt-get install ./jan-linux-amd64-{version}.deb
# where jan-linux-amd64-{version}.deb is path to the Jan package
```

For other Linux distributions, you launch the AppImage file without installation. To do so, you need to make the AppImage file executable and then run it. You can do this either through your file manager's properties dialog or with the following commands:

```bash
# Install Jan using AppImage
chmod +x jan-linux-x86_64-{version}.AppImage
./jan-linux-x86_64-{version}.AppImage
# where jan-linux-x86_64-{version}.AppImage is path to the Jan package
```

The typical installation process takes around a minute.

### GitHub Releases

Jan is also available from [Jan's GitHub Releases](https://github.com/janhq/jan/releases) page, with a recommended [latest stable release](https://github.com/janhq/jan/releases/latest).

Within the Releases' assets, you will find the following files for Linux:

```bash
# Debian Linux distribution
jan-linux-amd64-{version}.deb

# AppImage
jan-linux-x86_64-{version}.AppImage
```

## Uninstall Jan

To uninstall Jan on Linux, you should use your package manager's uninstall or remove option. For Debian/Ubuntu-based distributions, if you installed Jan via the `.deb` package, you can uninstall Jan using the following command:

```bash
sudo apt-get remove jan
# where jan is the name of Jan package
```

For other Linux distributions, if you installed Jan via the `.AppImage` file, you can uninstall Jan by deleting the `.AppImage` file.

In case you wish to completely remove all user data associated with Jan after uninstallation, you can delete the user data folders located at ~/jan. This will return your system to its state prior to the installation of Jan. This method can also be used to reset all settings if you are experiencing any issues with Jan.

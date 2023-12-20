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
  ]
---

# Installing Jan on Linux

## Installation

Jan is available for download via our homepage, [https://jan.ai](https://jan.ai/).

For Linux, the download should be available as a `.deb` file in the following format.

```bash
jan-linux-amd64-{version}.deb
```

The typical installation process takes around a minute.

### GitHub Releases

Jan is also available from [Jan's GitHub Releases](https://github.com/janhq/jan/releases) page, with a recommended [latest stable release](https://github.com/janhq/jan/releases/latest).

Within the Releases' assets, you will find the following files for Linux:

```bash
# Debian Linux distribution
jan-linux-amd64-{version}.deb
```

## Uninstall Jan

To uninstall VS Code on Linux, you should use your package manager's uninstall or remove option. For Debian/Ubuntu-based distributions, if you installed Jan via the `.deb` package, you can uninstall Jan using the following command:

```bash
sudo apt-get remove jan`
# where jan is the name of Jan package
```

In case you wish to completely remove all user data associated with Jan after uninstallation, you can delete the user data folders located at `$HOME/.config/Jan` and ~/.jan. This will return your system to its state prior to the installation of Jan. This method can also be used to reset all settings if you are experiencing any issues with Jan.

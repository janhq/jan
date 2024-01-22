---
title: Mac
slug: /install/mac
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

# Installing Jan on MacOS

## System Requirements

Ensure that your MacOS version is 13 or higher to run Jan.

## Installation

Jan is available for download via our homepage, [https://jan.ai/](https://jan.ai/).

For MacOS, the download should be available as a `.dmg` file in the following format.

```bash
# Intel Mac
jan-mac-x64-{version}.dmg
# Apple Silicon Mac
jan-mac-arm64-{version}.dmg
```

The typical installation process takes around a minute.

## GitHub Releases

Jan is also available from [Jan's GitHub Releases](https://github.com/janhq/jan/releases) page, with a recommended [latest stable release](https://github.com/janhq/jan/releases/latest).

Within the Releases' assets, you will find the following files for MacOS:

```bash
# Intel Mac (dmg file and zip file)
jan-mac-x64-{version}.dmg
jan-mac-x64-{version}.zip

# Apple Silicon Mac (dmg file and zip file)
jan-mac-arm64-{version}.dmg
jan-mac-arm64-{version}.zip
```

## Uninstall Jan

As Jan is in development mode, you might get stuck on a broken build.
To reset your installation

1. Delete Jan from your `/Applications` folder
2. Delete Application data

```bash
# Newer versions
rm -rf ~/Library/Application\ Support/jan

# Versions 0.2.0 and older
rm -rf ~/Library/Application\ Support/jan-electron
```

3. Clear Application cache

```bash
rm -rf ~/Library/Caches/jan*
```

4. Use the following commands to remove any dangling backend processes:

```bash
ps aux | grep nitro
```

Look for processes like "nitro" and "nitro_arm_64", and kill them one by one with:

```bash
kill -9 <PID>
```

## Common Questions

### Does Jan run on Apple Silicon machines?

Yes, Jan supports MacOS Arm64 builds that can run on Macs with the Apple Silicon chipsets. You can install Jan on your Apple Silicon Mac by downloading the `jan-mac-arm64-<version>.dmg` file from the [Jan's homepage](https://jan.ai/).

### Which package should I download for my Mac?

Jan supports both Intel and Apple Silicon Macs. To find which appropriate package to download for your Mac, please follow this official guide from Apple: [Get system information about your Mac - Apple Support](https://support.apple.com/guide/mac-help/syspr35536/mac).

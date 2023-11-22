---
title: Mac
---

# Jan on MacOS

## Installation
1. To download the lastest version of Jan on MacOS, please visit the [Jan's homepage](https://jan.ai/).
2. On the homepage, please choose the appropriate release version for your system architecture as follows:
    - Intel Mac: `jan-mac-x64-<version>.dmg`
    - Apple Silicon Mac: `jan-mac-arm64-<version>.dmg`

## Uninstall Jan
As Jan is development mode, you might get stuck on a broken build
To reset your installation
1. Delete Jan from your `/Applications` folder
2. Delete Application data
```bash
# Newer versions
rm -rf /Users/$(whoami)/Library/Application\ Support/jan

# Versions 0.2.0 and older
rm -rf /Users/$(whoami)/Library/Application\ Support/jan-electron
```
3. Clear Application cache
```bash
rm -rf /Users/$(whoami)/Library/Caches/jan*
```
4. Use the following commands to remove any dangling backend processes:
```bash
ps aux | grep nitro
```
Look for processes like "nitro" and "nitro_arm_64," and kill them one by one with:
```bash
kill -9 <PID>
```

## Common Questions

### Does Jan run on Apple Silicon machines? 
Yes, Jan supports MacOS Arm64 builds that can run on Macs with the Apple Silicon chipsets. You can install Jan on your Apple Silicon Mac by downloading the `jan-mac-arm64-<version>.dmg` file from the [Jan's homepage](https://jan.ai/).

### Which package should I download for my Mac?
Jan supports both Intel and Apple Silicon Macs. To find which appropriate package to download for your Mac, please follow this official guide from Apple: [Get system information about your Mac - Apple Support](https://support.apple.com/guide/mac-help/syspr35536/mac).
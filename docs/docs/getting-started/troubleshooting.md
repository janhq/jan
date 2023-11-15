---
title: Troubleshooting
sidebar_position: 5
---

# Jan.ai Troubleshooting Guide
Please note that 👋Jan is in "development mode," and you might encounter issues. If you need to reset your installation, follow these steps:

## Issue 1: Broken Build

As Jan is development mode, you might get stuck on a broken build.

To reset your installation:

1. Delete Jan from your `/Applications` folder

1. Delete Application data:
   ```sh
   # Newer versions
   rm -rf /Users/$(whoami)/Library/Application\ Support/jan

   # Versions 0.2.0 and older
   rm -rf /Users/$(whoami)/Library/Application\ Support/jan-electron
   ```
   
1. Clear Application cache:
   ```sh
   rm -rf /Users/$(whoami)/Library/Caches/jan*
   ```

1. Use the following commands to remove any dangling backend processes:

    ```sh
    ps aux | grep nitro
    ```

    Look for processes like "nitro" and "nitro_arm_64," and kill them one by one with:

    ```sh
    kill -9 <PID>
    ```
    

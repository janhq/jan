---
title: Troubleshooting
---

# Jan.ai Troubleshooting Guide
Please note that 👋Jan is in "development mode," and you might encounter issues. If you need to reset your installation, follow these steps:

## Issue 1: Broken Build
1. Delete the Jan Application from your computer.

2. Clear the cache by running one of the following commands:

    ```sh
    rm -rf /Users/$(whoami)/Library/Application\ Support/jan-electron
    ```

    or

    ```sh
    rm -rf /Users/$(whoami)/Library/Application\ Support/jan
    ```

3. If the above steps fail, use the following commands to find and kill any problematic processes:

    ```sh
    ps aux | grep nitro
    ```

    Look for processes like "nitro" and "nitro_arm_64," and kill them one by one with:

    ```sh
    kill -9 <PID>
    ```
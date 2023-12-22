---
title: Stuck on a Broken Build
slug: /troubleshooting/stuck-on-broken-build
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
    troubleshooting,
  ]
---

The following steps will help you troubleshoot and resolve issues related to broken builds.

1. Delete the application data

```bash
# Newer versions
rm -rf /Users/$(whoami)/Library/Application\ Support/jan

# Versions 0.2.0 and older
rm -rf /Users/$(whoami)/Library/Application\ Support/jan-electron
```

2. Clear application cache

```bash
rm -rf /Users/$(whoami)/Library/Caches/jan*
```

3. Remove user data

```bash
rm -rf ./jan
```

4. Delete Jan from your `/Applications` folder

5. If you are using version before `0.4.2` you need to run the following commands

```bash
ps aux | grep nitro
# Looks for processes like `nitro` and `nitro_arm_64`, and kill them one by one by process ID
kill -9 <PID>
```

6. Download the latest version from via our homepage, [https://jan.ai/](https://jan.ai/).

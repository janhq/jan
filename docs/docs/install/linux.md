---
title: Linux
---

# Jan on Linux

## Installation

1. To download the lastest version of Jan on Linux, please visit the [Jan's homepage](https://jan.ai/).
2. For Debian/Ubuntu-based distributions, the recommended installation method is through the `.deb` package (64-bit). This can be done either through the graphical software center, if available, or via the command line using the following:
```bash
sudo apt install ./jan-linux-amd64-<version>.deb
# sudo apt install ./jan-linux-arm64-0.3.1.deb
```

## Uninstall Jan
To uninstall VS Code on Linux, you should use your package manager's uninstall or remove option. For Debian/Ubuntu-based distributions, if you installed Jan via the `.deb` package, you can uninstall Jan using the following command:
```bash
sudo apt-get remove jan`
# where jan is the name of Jan package
``` 
In case you wish to completely remove all user data associated with Jan after uninstallation, you can delete the user data folders located at `$HOME/.config/Jan` and ~/.jan. This will return your system to its state prior to the installation of Jan. This method can also be used to reset all settings if you are experiencing any issues with Jan.
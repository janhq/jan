# Jan - Bring AI to your Desktop

![Jan banner](https://github.com/janhq/jan/assets/89722390/35daac7d-b895-487c-a6ac-6663daaad78e)

<p align="center">
  <!-- ALL-CONTRIBUTORS-BADGE:START - Do not remove or modify this section -->
  <img alt="GitHub commit activity" src="https://img.shields.io/github/commit-activity/m/janhq/jan"/>
  <img alt="Github Last Commit" src="https://img.shields.io/github/last-commit/janhq/jan"/>
  <img alt="Github Contributors" src="https://img.shields.io/github/contributors/janhq/jan"/>
  <img alt="GitHub closed issues" src="https://img.shields.io/github/issues-closed/janhq/jan"/>
  <img alt="Discord" src="https://img.shields.io/discord/1107178041848909847?label=discord"/>
</p>

<p align="center">
  <a href="https://jan.ai/guides">Getting Started</a> 
  - <a href="https://jan.ai/docs">Docs</a> 
  - <a href="https://github.com/janhq/jan/releases">Changelog</a> 
  - <a href="https://github.com/janhq/jan/issues">Bug reports</a> 
  - <a href="https://discord.gg/AsJ8krTT3N">Discord</a>
</p>

> ⚠️ **Jan is currently in Development**: Expect breaking changes and bugs!

Jan is an open-source ChatGPT alternative that runs 100% offline on your computer.

**Jan runs on any hardware.** From PCs to multi-GPU clusters, Jan supports universal architectures:

- [x] Nvidia GPUs (fast)
- [x] Apple M-series (fast)
- [x] Apple Intel
- [x] Linux Debian
- [x] Windows x64

## Download

<table>
  <tr>
    <td style="text-align:center"><b>Version Type</b></td>
    <td style="text-align:center"><b>Windows</b></td>
    <td colspan="2" style="text-align:center"><b>MacOS</b></td>
    <td style="text-align:center"><b>Linux</b></td>
  </tr>
  <tr>
    <td style="text-align:center"><b>Stable (Recommended)</b></td>
    <td style="text-align:center">
      <a href='https://github.com/janhq/jan/releases/download/v0.4.3/jan-win-x64-0.4.3.exe'>
        <img src='./docs/static/img/windows.png' style="height:14px; width: 14px" />
        <b>jan.exe</b>
      </a>
    </td>
    <td style="text-align:center">
      <a href='https://github.com/janhq/jan/releases/download/v0.4.3/jan-mac-x64-0.4.3.dmg'>
        <img src='./docs/static/img/mac.png' style="height:15px; width: 15px" />
        <b>Intel</b>
      </a>
    </td>
    <td style="text-align:center">
      <a href='https://github.com/janhq/jan/releases/download/v0.4.3/jan-mac-arm64-0.4.3.dmg'>
        <img src='./docs/static/img/mac.png' style="height:15px; width: 15px" />
        <b>M1/M2</b>
      </a>
    </td>
    <td style="text-align:center">
      <a href='https://github.com/janhq/jan/releases/download/v0.4.3/jan-linux-amd64-0.4.3.deb'>
        <img src='./docs/static/img/linux.png' style="height:14px; width: 14px" />
        <b>jan.deb</b>
      </a>
    </td>
  </tr>
  <tr style="text-align: center">
    <td style="text-align:center"><b>Experimental (Nightly Build)</b></td>
    <td style="text-align:center" colspan="4">
      <a href='https://github.com/janhq/jan/actions/runs/7382651728'>
        <b>Github action artifactory</b>
      </a>
    </td>
  </tr>
</table>

Download the latest version of Jan at https://jan.ai/ or visit the **[GitHub Releases](https://github.com/janhq/jan/releases)** to download any previous release.

## Demo

![Demo](/demo.gif)

_Realtime Video: Jan v0.4.3-nightly on a Mac M1, 16GB Sonoma 14_

## Quicklinks

#### Jan

- [Jan website](https://jan.ai/)
- [Jan Github](https://github.com/janhq/jan)
- [User Guides](https://jan.ai/guides/)
- [Developer docs](https://jan.ai/developer/)
- [API reference](https://jan.ai/api-reference/)
- [Specs](https://jan.ai/docs/)

#### Nitro

Nitro is a high-efficiency C++ inference engine for edge computing. It is lightweight and embeddable, and can be used on its own within your own projects.

- [Nitro Website](https://nitro.jan.ai)
- [Nitro Github](https://github.com/janhq/nitro)
- [Documentation](https://nitro.jan.ai/docs)
- [API Reference](https://nitro.jan.ai/api-reference)

## Troubleshooting

As Jan is in development mode, you might get stuck on a broken build.

To reset your installation:

1. **Remove Jan from your Applications folder and Cache folder**

   ```bash
   make clean
   ```

   This will remove all build artifacts and cached files:

   - Delete Jan from your `/Applications` folder
   - Clear Application cache in `/Users/$(whoami)/Library/Caches/jan`

2. Use the following commands to remove any dangling backend processes:

   ```sh
   ps aux | grep nitro
   ```

   Look for processes like "nitro" and "nitro_arm_64," and kill them one by one with:

   ```sh
   kill -9 <PID>
   ```

## Contributing

Contributions are welcome! Please read the [CONTRIBUTING.md](CONTRIBUTING.md) file

### Pre-requisites

- node >= 20.0.0
- yarn >= 1.22.0
- make >= 3.81

### Instructions

1. **Clone the repository and prepare:**

    ```bash
    git clone https://github.com/janhq/jan
    cd jan
    git checkout -b DESIRED_BRANCH
    ```

2. **Run development and use Jan Desktop**

    ```bash
    make dev
    ```

This will start the development server and open the desktop app.

### For production build

```bash
# Do steps 1 and 2 in the previous section
# Build the app
make build
```

This will build the app MacOS m1/m2 for production (with code signing already done) and put the result in `dist` folder.

## Nightly Build

Our nightly build process for this project is defined in [`.github/workflows/jan-electron-build-nightly.yml`](.github/workflows/jan-electron-build-nightly.yml)

The nightly build is triggered at 2:00 AM UTC every day.

Getting on Nightly:

1. Join our Discord server [here](https://discord.gg/FTk2MvZwJH) and go to channel [github-jan](https://discordapp.com/channels/1107178041848909847/1148534730359308298).
2. Download the build artifacts from the channel.
3. Subsequently, to get the latest nightly, just quit and restart the app.
4. Upon app restart, you will be automatically prompted to update to the latest nightly build.

## Manual Build

Stable releases are triggered by manual builds. This is usually done for new features or a bug fixes.

The process for this project is defined in [`.github/workflows/jan-electron-build-nightly.yml`](.github/workflows/jan-electron-build-nightly.yml)

## Acknowledgements

Jan builds on top of other open-source projects:

- [llama.cpp](https://github.com/ggerganov/llama.cpp)
- [TensorRT](https://github.com/NVIDIA/TensorRT)

## Contact

- Bugs & requests: file a GitHub ticket
- For discussion: join our Discord [here](https://discord.gg/FTk2MvZwJH)
- For business inquiries: email hello@jan.ai
- For jobs: please email hr@jan.ai

## License

Jan is free and open source, under the AGPLv3 license.

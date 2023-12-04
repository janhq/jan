# Jan - Own Your AI

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

Jan is a free, open-source alternative to OpenAI's platform that runs on a local folder of open-format files.

**Jan runs on any hardware.** From PCs to multi-GPU clusters, Jan supports universal architectures:

- [x] Nvidia GPUs (fast)
- [x] Apple M-series (fast)
- [x] Apple Intel
- [x] Linux Debian
- [x] Windows x64

> Download Jan at https://jan.ai/

## Demo

<p align="center">
  <video src="https://github.com/janhq/jan/assets/89722390/47988dcc-13ed-4ca0-87f7-74d00f4d47d8"> 
  </video>
</p>

_Video: Jan v0.3.0 on Mac Air M2, 16GB Ventura_

## Quicklinks

- [User Guides](https://jan.ai/docs)
- [Developer docs](https://jan.ai/docs)
- [API reference](https://jan.ai/api/overview)
- [Nitro Github](https://nitro.jan.ai): Nitro is a C++ inference engine

## Troubleshooting

As Jan is development mode, you might get stuck on a broken build.

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

1. **Clone the Repository:**

```bash
   git clone https://github.com/janhq/jan
   git checkout DESIRED_BRANCH
   cd jan
```

2. **Run development and Using Jan Desktop**

   ```
   make dev
   ```

   This will start the development server and open the desktop app.

### For production build

```bash
# Do step 1 and 2 in previous section
git clone https://github.com/janhq/jan
cd jan

# Build the app
make build
```

This will build the app MacOS m1/m2 for production (with code signing already done) and put the result in `dist` folder.

## Nightly Build

Nightly build is a process where the software is built automatically every night. This helps in detecting and fixing bugs early in the development cycle. The process for this project is defined in [`.github/workflows/jan-electron-build-nightly.yml`](.github/workflows/jan-electron-build-nightly.yml)

You can join our Discord server [here](https://discord.gg/FTk2MvZwJH) and go to channel [github-jan](https://discordapp.com/channels/1107178041848909847/1148534730359308298) to monitor the build process.

The nightly build is triggered at 2:00 AM UTC every day.

The nightly build can be downloaded from the url notified in the Discord channel. Please access the url from the browser and download the build artifacts from there.

## Manual Build

Manual build is a process where the software is built manually by the developers. This is usually done when a new feature is implemented or a bug is fixed. The process for this project is defined in [`.github/workflows/jan-electron-build-nightly.yml`](.github/workflows/jan-electron-build-nightly.yml)

It is similar to the nightly build process, except that it is triggered manually by the developers.

## Acknowledgements

Jan builds on top of other open-source projects:

- [llama.cpp](https://github.com/ggerganov/llama.cpp)
- [TensorRT](https://github.com/NVIDIA/TensorRT)

## Contact

- Bugs & requests: file a Github ticket
- For discussion: join our Discord [here](https://discord.gg/FTk2MvZwJH)
- For business inquiries: email hello@jan.ai
- For jobs: please email hr@jan.ai

## License

Jan is free and open source, under the AGPLv3 license.

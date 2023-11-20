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
    
## Contributing

Contributions are welcome! Please read the [CONTRIBUTING.md](CONTRIBUTING.md) file

### Pre-requisites

- node >= 20.0.0
- yarn >= 1.22.0

### Instructions

Note: This instruction is tested on MacOS only.

1. **Clone the Repository:**

```bash
   git clone https://github.com/janhq/jan
   git checkout DESIRED_BRANCH
   cd jan
```

2. **Install dependencies:**

```bash
   yarn install

   # Build core module
   yarn build:core

   # Packing base plugins
   yarn build:plugins

   # Packing uikit
   yarn build:uikit
```

3. **Run development and Using Jan Desktop**

   ```
   yarn dev
   ```

   This will start the development server and open the desktop app.
   In this step, there are a few notification about installing base plugin, just click `OK` and `Next` to continue.

### For production build

```bash
# Do step 1 and 2 in previous section
git clone https://github.com/janhq/jan
cd jan
yarn install

# Build core module
yarn build:core

# Package base plugins
yarn build:plugins

# Packing uikit
yarn build:uikit

# Build the app
yarn build
```

This will build the app MacOS m1/m2 for production (with code signing already done) and put the result in `dist` folder.

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

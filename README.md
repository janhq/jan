# Jan - Personal AI

![Project Cover](https://github.com/janhq/jan/assets/89722390/be4f07ef-13df-4621-8f25-b861f1d5b7b3)

<p align="center">
  <!-- ALL-CONTRIBUTORS-BADGE:START - Do not remove or modify this section -->
  <img alt="GitHub commit activity" src="https://img.shields.io/github/commit-activity/m/janhq/jan"/>
  <img alt="Github Last Commit" src="https://img.shields.io/github/last-commit/janhq/jan"/>
  <img alt="Github Contributors" src="https://img.shields.io/github/contributors/janhq/jan"/>
  <img alt="GitHub closed issues" src="https://img.shields.io/github/issues-closed/janhq/jan"/>
  <img alt="Discord" src="https://img.shields.io/discord/1107178041848909847?label=discord"/>
</p>

<p align="center">
  <a href="https://docs.jan.ai/">Getting Started</a> - <a href="https://docs.jan.ai">Docs</a> 
  - <a href="https://github.com/janhq/jan/releases">Changelog</a> - <a href="https://github.com/janhq/jan/issues">Bug reports</a> - <a href="https://discord.gg/AsJ8krTT3N">Discord</a>
</p>

> ⚠️ **Jan is currently in Development**: Expect breaking changes and bugs!

Jan is a powerful Personal AI built to run locally on your machine, with a rich app and plugin ecosystem.

Jan is free and open source, under the GPLv3 license.

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

- [Developer docs](https://jan.ai/docs) (WIP)
- Mobile App shell: [App Store](https://apps.apple.com/us/app/jan-on-device-ai-cloud-ais/id6449664703) | [Android](https://play.google.com/store/apps/details?id=com.jan.ai)
- [Nitro Github](https://nitro.jan.ai): Jan's AI engine

## Plugins

Jan supports core & 3rd party extensions:

- [x] **LLM chat**: Self-hosted Llama2 and LLMs
- [x] **Model Manager**: 1-click to install, swap, and delete models with HuggingFace integration
- [x] **Storage**: Optionally save conversation history and other data in SQLite
- [ ] **3rd-party AIs**: Connect to ChatGPT, Claude via API Key (in progress)
- [ ] **Cross device support**: Mobile & Web support for custom shared servers (in progress)
- [ ] **File retrieval**: User can chat with docs
- [ ] **Multi-user support**: Share a single server across a team/friends (planned)
- [ ] **Compliance**: Auditing and flagging features (planned)

## Nitro (Jan's AI engine)

In the background, Jan runs [Nitro](https://nitro.jan.ai), an open source, C++ inference engine. It runs various model formats (GGUF/TensorRT) on various hardware (Mac M1/M2/Intel, Windows, Linux, and datacenter-grade Nvidia GPUs) with optional GPU acceleration.

> See the open source Nitro codebase at https://nitro.jan.ai.

## Troubleshooting

As Jan is development mode, you might get stuck on a broken build.

To reset your installation:

1. Delete Jan Application from /Applications

1. Clear cache:
   `rm -rf /Users/$(whoami)/Library/Application\ Support/jan-electron`
   OR
   `rm -rf /Users/$(whoami)/Library/Application\ Support/jan`

---

## Contributing

Contributions are welcome! Please read the [CONTRIBUTING.md](CONTRIBUTING.md) file

### Pre-requisites

- node >= 20.0.0
- yarn >= 1.22.0

### Instructions

Note: This instruction is tested on MacOS only.

1. **Clone the Repository:**

   ```
   git clone https://github.com/janhq/jan
   git checkout DESIRED_BRANCH
   cd jan
   ```

2. **Install dependencies:**

   ```
   yarn install

   # Packing base plugins
   yarn build:plugins
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
yarn build:plugins

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

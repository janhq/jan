# Jan - Run your own AI

<p align="center">
  <img alt="janlogo" src="https://user-images.githubusercontent.com/69952136/266827788-b37d6f41-fc34-4677-aa1f-3e2ca6d3c91a.png">
</p>

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
  - <a href="https://docs.jan.ai/changelog/">Changelog</a> - <a href="https://github.com/janhq/jan/issues">Bug reports</a> - <a href="https://discord.gg/AsJ8krTT3N">Discord</a>
</p>

> ⚠️ **Jan is currently in Development**: Expect breaking changes and bugs!

Use offline LLMs with your own data. Run open source models like Llama2 or Falcon on your internal computers/servers.

Jan runs on any hardware, from PCs to multi-GPU clusters. Jan supports both CPU and GPU on the following architecture:

- [x] Nvidia GPUs (fast)
- [x] Apple M-series (fast)
- [x] Apple Intel
- [x] Linux Debian
- [x] Windows x64

> Download Jan at https://jan.ai/

## Demo

<p align="center">
  <img style='border:1px solid #000000' src="https://github.com/janhq/jan/assets/69952136/1db9c3d3-79b1-4988-afb5-afd4f4afd0d9" alt="Jan Web GIF">
</p>

_Screenshot: Jan v0.1.3 on Mac M1 Pro, 16GB Sonoma_

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

## Nitro (Jan's AI egine)

In the background, Jan runs [Nitro](https://nitro.jan.ai), an open source, C++ inference engine. It runs various model formats (GGUF/TensorRT) on various hardware (Mac M1/M2/Intel, Windows, Linux, and datacenter-grade Nvidia GPUs) with optional GPU acceleration.

> See the open source Nitro codebase at https://nitro.jan.ai.

## Contributing

Contributions are welcome! Please read the [CONTRIBUTING.md](CONTRIBUTING.md) file

### Pre-requisites

- node >= 20.0.0
- yarn >= 1.22.0

### Use as complete suite (in progress)

### For interactive development

Note: This instruction is tested on MacOS only.

1. **Clone the Repository:**

   ```
   git clone https://github.com/janhq/jan
   git checkout feature/hackathon-refactor-jan-into-electron-app
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

## License

Jan is free, [open core](https://en.wikipedia.org/wiki/Open-core_model), and Sustainable Use Licensed.

## Acknowledgements

Jan builds on top of other open-source projects:

- [llama.cpp](https://github.com/ggerganov/llama.cpp)
- [TensorRT](https://github.com/NVIDIA/TensorRT)
- [Keycloak Community](https://github.com/keycloak/keycloak) (Apache-2.0)

## Contact

- Bugs & requests: file a Github ticket
- For discussion: join our Discord [here](https://discord.gg/FTk2MvZwJH)
- For business inquiries: email hello@jan.ai
- For jobs: please email hr@jan.ai

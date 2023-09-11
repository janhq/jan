# Jan - Self-Hosted AI Platform

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

Jan is a self-hosted AI Platform. We help you run AI on your own hardware, giving you full control and protecting your enterprises' data and IP. 

Jan is free, source-available, and [fair-code](https://faircode.io/) licensed.

## Demo

👋 https://cloud.jan.ai

## Features

**Multiple AI Engines**
- [x] Self-hosted Llama2 and LLMs 
- [x] Self-hosted StableDiffusion and Controlnet
- [ ] Connect to ChatGPT, Claude via API Key (coming soon)
- [ ] 1-click installs for Models (coming soon)

**Cross-Platform**
- [x] Web App
- [ ] Jan Mobile support for custom Jan server (in progress)
- [ ] Cloud deployments (coming soon)

**Organization Tools**
- [x] Multi-user support 
- [ ] Audit and Usage logs (coming soon)
- [ ] Compliance and Audit (coming soon)
- [ ] PII and Sensitive Data policy engine for 3rd-party AIs (coming soon)

**Hardware Support**

- [ ] Nvidia GPUs 
- [ ] Apple Silicon (in progress)
- [ ] CPU support via llama.cpp (in progress)

## Documentation

👋 https://docs.jan.ai (Work in Progress)

## Getting Started

To quickly get started with Jan, check out the [Quick Start Guide](/docs/docs/guides/quickstart.md)

To deploy Jan for your production environment, checkout out the [Production Installation Guide](/docs/docs/guides/installation.md) (in progress)

For help, please open an issue in this repository.

## About Jan

Jan is a commercial company with a [Fair Code](https://faircode.io/) business model. This means that while we are open-source and can used for free, we require commercial licenses for specific use cases (e.g. hosting Jan as a service). 

We are a team of engineers passionate about AI, productivity and the future of work. We are funded through consulting contracts and enterprise licenses. Feel free to reach out to us!

### Repo Structure

Jan comprises of several repositories: 

| Repo                                                    | Purpose                                                                                                                                                       |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Jan](https://github.com/janhq/jan)                     | AI Platform to run AI in the enterprise. Easy-to-use for users, and packed with useful organizational and compliance features.                                |
| [Jan Mobile](https://github.com/janhq/jan-react-native) | Mobile App that can be pointed to a custom Jan server.                                                                                                        |
| [Nitro](https://github.com/janhq/nitro)                 | Inference Engine that runs AI on different types of hardware. Offers popular API formats (e.g. OpenAI, Clipdrop). Written in C++ for blazing fast performance |

### Architecture

Jan builds on top of several open-source projects:

- [Keycloak Community](https://github.com/keycloak/keycloak) (Apache-2.0)
- [Hasura Community Edition](https://github.com/hasura/graphql-engine) (Apache-2.0)

We may re-evaluate this in the future, given different customer requirements. 


### Contributing

Contributions are welcome! Please read the [CONTRIBUTING.md](CONTRIBUTING.md) file for guidelines on how to contribute to this project.

Please note that Jan intends to build a sustainable business that can provide high quality jobs to its contributors. If you are excited about our mission and vision, please contact us to explore opportunities. 

### Contact

- For support: please file a Github ticket
- For questions: join our Discord [here](https://discord.gg/FTk2MvZwJH)
- For long form inquiries: please email hello@jan.ai

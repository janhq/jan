---
title: About Jan
slug: /about
description: Jan is a desktop application that turns computers into thinking machines.
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
    about Jan,
    desktop application,
    thinking machine,
  ]
---

Jan turns computers into a thinking machine to change how you use computers.
Jan is created and maintained by Jan Labs, a robotics company.

With Jan, you can:

- Run [open-source LLMs](https://huggingface.co/models?pipeline_tag=text-generation) locally or connect to cloud AIs like [ChatGPT](https://openai.com/blog/openai-api) or [Google](https://ai.google.dev/).
- Fine-tune AI with specific knowledge.
- Supercharge your productivity by leveraging AI.
- Search the web and databases.
- Integrate AI with everyday tools to work on your behalf (with permission).
- Customize and add features with Extensions.

:::tip

Jan aims for long-term human-robot collaboration, envisioning AI as a harmonious extension of human capabilities. Our goal is to build customizable robots that we continually improve and customize, growing together.

:::

![Human repairing a Droid](/img/star-wars-droids.png)

## Jan’s principles

- **Ownership**: Jan is committed to developing a product that fully belongs to users. You're the true owner, free from data tracking and storage by us.
- **Privacy**: Jan works locally by default, allowing use without an internet connection. Your data stays on your device in a universal format, giving you complete privacy control.
- **100% User Supported**: Every user can access, develop, and customize Jan's codebases to suit their needs.
- **Rejecting Dark Patterns**: We never use tricks to extract more money or lock you into an ecosystem.

## Why do we exist?

> _"I do not fear computers. I fear the lack of them." - Isaac Asimov_

Jan was founded on the belief that AI should coexist with humans, not replace them. Our mission is to democratize AI access, ensuring everyone can easily utilize it with full ownership and control over their data, free from privacy concerns.

### What are the things Jan committed on?

We are committed to creating open, local-first products that extend individual freedom, rejecting dark patterns and ecosystem lock-ins, and embracing an open-source ethos.

#### What's different about it?

|                       | Status Quo                 | Jan                                                                    |
| --------------------- | -------------------------- | ---------------------------------------------------------------------- |
| **Ownership**         | Owned by Big Tech          | Fully owned by you                                                     |
| **Openness**          | Closed-source              | [Open-source (AGPLv3)](https://github.com/janhq/jan/blob/main/LICENSE) |
| **Your Role**         | Consumer                   | Creator                                                                |
| **Approach**          | Cloud-based                | [Local-first](https://www.inkandswitch.com/local-first/)               |
| **Data Handling**     | Stored on external servers | Stored locally, openly accessible                                      |
| **Privacy**           | Questionable               | Private and offline                                                    |
| **Transparency**      | Opaque "Black Box"         | Open-source and customizable                                           |
| **Outage Resilience** | Potential data hostage     | Continues to work on your device                                       |
| **Philosophy**        | User monetization          | Empowerment with the right to repair                                   |

## How we work

Jan is an open-source product with transparent development and future features. Users have the right to modify and customize Jan. We are committed to building an open-source AI ecosystem.

Jan is building in public using GitHub, where anyone is welcome to join. Key resources include Jan's [Kanban](https://github.com/orgs/janhq/projects/5/views/7) and Jan's [Roadmap](https://github.com/orgs/janhq/projects/5/views/29).

Jan has a fully-remote team, primarily based in the APAC timezone, and we use Discord and GitHub for collaboration. Our community is central to our operations, and we embrace asynchronous work. We hold meetings only for synchronization and vision sharing, using [Excalidraw](https://excalidraw.com/) or [Miro](https://miro.com/) for visualization and sharing notes on Discord for alignment. We also use [HackMD](https://hackmd.io/) to document our ideas and build a Jan library.

## How to get it?

You can install and start using Jan in less than 5 minutes, from [Jan.ai](https://jan.ai) or our [Github repo](https://github.com/janhq/jan).

## What license is the code under?

Jan is licensed under the [AGPLv3 License](https://github.com/janhq/jan/blob/main/LICENSE).

We happily accept pull requests, however, we do ask that you sign a [Contributor License Agreement](https://en.wikipedia.org/wiki/Contributor_License_Agreement) so that we have the right to relicense your contributions[^2].

## What was it built with?

[Jan](https://github.com/janhq/jan) is pragmatically built using `Typescript` at the application level and `C++` at the Inference level (which we have refactored into [Nitro](https://nitro.jan.ai)[^3]).

We follow [clean architecture](https://blog.cleancoder.com/uncle-bob/2012/08/13/the-clean-architecture.html) and currently support multiple frameworks and runtimes:

- A desktop client with [Electron](https://www.electronjs.org/)
- A headless server-mode with [Nodejs](https://nodejs.org/en)
- Planned support for mobile with [Capacitor](https://capacitorjs.com/)
- Planned support for Python runtime

Architecturally, we have made similar choices to the [Next.js Enterprise Javascript Stack](https://vercel.com/templates/next.js/nextjs-enterprise-boilerplate), which is a [battle-tested](https://nextjs.org/showcase/enterprise) framework for building enterprise-grade applications that scale.

## Join the team

Join us on this journey at Jan Labs, where we embrace open-source collaboration and transparency. Together, let's shape a future where Jan becomes an essential companion in the open-source community. Explore [careers](https://janai.bamboohr.com/careers) with us.

## Contact

Drop us a message in our [Discord](https://discord.gg/af6SaTdzpx) and we'll get back to you.

- `#general`: for general discussion
- `#get-help`: for bug reports and troubleshooting
- `#roadmap`: for feature requests and ideas

## Footnotes

[^1]: Credit to Obsidian's original website
[^2]: Credit to [Discourse's About Page](https://www.discourse.org/about)
[^3]: Credit to [Llama.cpp](https://github.com/ggerganov/llama.cpp), [TensorRT-LLM](https://github.com/NVIDIA/TensorRT-LLM), [vLLM](https://github.com/vllm-project/vllm), [LMDeploy](https://github.com/InternLM/lmdeploy) and more.

---
title: Chats
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
  ]
---

:::caution

This is currently under development.

:::

## Overview

In Jan, `chats` are LLM responses in the form of OpenAI compatible `chat completion objects`.

- Models take a list of messages and return a model-generated response as output.
- An [OpenAI Chat API](https://platform.openai.com/docs/api-reference/chat) compatible endpoint at `localhost:1337/v1/chats`.

## Folder Structure

Chats are stateless, thus are not saved in `janroot`. Any content and relevant metadata from calling this endpoint is extracted and persisted through [Messages](/docs/engineering/messages).

## API Reference

Jan's Chat API is compatible with [OpenAI's Chat API](https://platform.openai.com/docs/api-reference/chat).

See [Jan Chat API](https://jan.ai/api-reference/#tag/Chat-Completion)

## Implementation

Under the hood, the `/chat` endpoint simply reroutes an existing endpoint from [Nitro server](https://nitro.jan.ai). Nitro is a lightweight & local inference server, written in C++ and embedded into the Jan app. See [Nitro documentation](https://nitro.jan.ai/docs).

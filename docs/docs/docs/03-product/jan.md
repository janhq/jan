---
title: Jan (The Default Assistant)
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

Jan ships with a default assistant "Jan" that lets users chat with any open source model out-of-the-box.

This assistant is defined in `/jan`. It is a generic assistant to illustrate power of Jan. In the future, it will support additional features e.g. multi-assistant conversations

- Your Assistant "Jan" lets you pick any model that is in the root /models folder
- Right panel: pick LLM model and set model parameters
- Jan’s threads will be at root level
- `model.json` will reflect model chosen for that session
- Be able to “add” other assistants in the future
- Jan’s files will be at thread level
- Jan is not a persistent memory assistant

---
title: Quickstart
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

Jan is compatible with all GGUF models.

In this guide we will use our latest model, [Pandora](https://huggingface.co/janhq/pandora-v1-10.7b-GGUF), as an example.

## 1. Create a model folder

Navigate to `~/jan/models` folder on your computer.

In `App Settings`, go to `Advanced`, then `Open App Directory`.

```sh
# Windows
C:/Users/<your_user_name>/jan/models

# MacOS/Linux
jan/models
```

In the `models` folder, create a folder with the name of the model.

```sh
mkdir pandora-v1-q4
```

## 2. Create a model JSON

Jan follows a standardized model template, called a `model.json`. This allows for easy model configurations, exporting, and sharing.

```sh
cd pandora-v1-q4
touch model.json
```

The following is an example template for `model.json`

```
{
    "source_url": "https://huggingface.co/janhq/pandora-v1-10.7b-GGUF/blob/main/pandora-v1-10.7b.Q4_K_M.gguf",
    "id": "pandora-v1-10-7b-gguf",
    "object": "model",
    "name": "PandoraQ4",
    "version": "1.0",
    "description": "A helpful assistant",
    "format": "gguf",
    "settings": {
      "ctx_len": 2048,
      "prompt_template": "<|im_start|>system\n{system_message}<|im_end|>\n<|im_start|>user\n{prompt}<|im_end|>\n<|im_start|>assistant"
    },
    "parameters": {
      "max_tokens": 2048
    },
    "metadata": {
      "author": "Jan",
      "tags": ["7B", "Finetuned"]
    },
    "engine": "nitro"
  }
```

:::caution
Ensure the `source_url` is the link to download model

Ensure the `id` is the same with the new created folder

Ensure to choose right `prompt_template`
:::

# 3. Use your model

Restart the Jan application and look for your model in the Hub.

![image](https://hackmd.io/_uploads/HJLAqvwI6.png)

There you go. If you have any questions or want to request for more preconfigured GGUF models, please message us on [Jan Discord](https://discord.gg/Dt7MxDyNNZ).

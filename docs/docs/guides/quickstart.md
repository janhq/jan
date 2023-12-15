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

In this guide we will use our latest model, [Trinity](https://huggingface.co/janhq/trinity-v1-GGUF), as an example.

## 1. Create a model folder

Navigate to `~/jan/models` folder on your computer.

In `App Settings`, go to `Advanced`, then `Open App Directory`.

Or, you can directly cd into:

```sh
# Windows
C:/Users/<your_user_name>/jan/models

# MacOS/Linux
jan/models
```

In the `models` folder, create a folder with the name of the model.

```sh
mkdir trinity-v1-7b
```

## 2. Create a model JSON

Jan follows a folder-based, [standard model template](/specs/models) called a `model.json`. This allows for easy model configurations, exporting, and sharing.

```sh
cd trinity-v1-7b
touch model.json
```

Copy the following into the `model.json`

```js
{
    "source_url": "https://huggingface.co/janhq/trinity-v1-GGUF/resolve/main/trinity-v1.Q4_K_M.gguf",
    "id": "trinity-v1-7b",
    "object": "model",
    "name": "Trinity 7B Q4",
    "version": "1.0",
    "description": "Trinity is an experimental model merge of GreenNodeLM & LeoScorpius using the Slerp method. Recommended for daily assistance purposes.",
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
      "tags": ["7B", "Merged", "Featured"],
      "size": 4370000000
    },
    "engine": "nitro"
  }
```

:::caution
Ensure the `source_url` property is the direct binary download link ending in `.gguf`. Find the links in Huggingface > `Files and versions`.

Ensure the `id` property is the model foldername

Ensure you are using the correct `prompt_template`
:::

## 3. Download your model binary

Restart the Jan application and look for your model in the Hub.

Click the green `download` button to download your actual model binary from the URL you provided.

![image](https://hackmd.io/_uploads/HJLAqvwI6.png)

There you go! You are ready to use your model.

If you have any questions or want to request for more preconfigured GGUF models, please message us in [Discord](https://discord.gg/Dt7MxDyNNZ).

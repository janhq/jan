---
title: Models
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

In Jan, models are primary entities with the following capabilities:

- Users can import, configure, and run models locally.
- An [OpenAI Model API](https://platform.openai.com/docs/api-reference/models) compatible endpoint at `localhost:1337/v1/models`.
- Supported model formats: `ggufv3`, and more.

## Folder Structure

- Models are stored in the `/models` folder.
- Models are organized by individual folders, each containing the binaries and configurations needed to run the model. This makes for easy packaging and sharing.
- Model folder names are unique and used as `model_id` default values.

```yaml
jan/                               # Jan root folder
  models/
    llama2-70b-q4_k_m/             # Example: standard GGUF model
        model.json
        model-binary-1.gguf
    mistral-7b-gguf-q3_k_l/        # Example: quantizations are separate folders
        model.json
        mistral-7b-q3-K-L.gguf
    mistral-7b-gguf-q8_k_m/        # Example: quantizations are separate folders
        model.json
        mistral-7b-q8_k_k.gguf
    llava-ggml-Q5/                 # Example: model with many partitions
        model.json
        mmprj.bin
        model_q5.ggml
```

## `model.json`

- Each `model` folder contains a `model.json` file, which is a representation of a model.
- `model.json` contains metadata and default parameters used to run a model.

### Example

Here's a standard example `model.json` for a GGUF model.

```js
{
  "id": "zephyr-7b",        // Defaults to foldername
  "object": "model",        // Defaults to "model"
  "sources": [
    {
      "filename": "zephyr-7b-beta.Q4_K_M.gguf",
      "url": "https://huggingface.co/TheBloke/zephyr-7B-beta-GGUF/blob/main/zephyr-7b-beta.Q4_K_M.gguf"
    }
  ],
  "name": "Zephyr 7B",      // Defaults to foldername
  "owned_by": "you",        // Defaults to "you"
  "version": "1",           // Defaults to 1
  "created": 1231231,       // Defaults to file creation time
  "description": null,      // Defaults to null
  "format": "ggufv3",       // Defaults to "ggufv3"
  "engine": "nitro",        // engine_id specified in jan/engine folder
  "engine_parameters": {
    // Engine parameters inside model.json can override
    "ctx_len": 4096,        // the value inside the base engine.json
    "ngl": 100,
    "embedding": true,
    "n_parallel": 4
  },
  "model_parameters": {
    // Models are called parameters
    "stream": true,
    "max_tokens": 4096,
    "stop": ["<endofstring>"], // This usually can be left blank, only used with specific need from model author
    "frequency_penalty": 0,
    "presence_penalty": 0,
    "temperature": 0.7,
    "top_p": 0.95
  },
  "metadata": {},           // Defaults to {}
  "assets": [
    // Defaults to current dir
    "file://.../zephyr-7b-q4_k_m.bin"
  ]
}
```

The engine parameters in the example can be found at: [Nitro's model settings](https://nitro.jan.ai/features/load-unload#table-of-parameters)

The model parameters in the example can be found at: [Nitro's model parameters](https://nitro.jan.ai/api-reference#tag/Chat-Completion)

## API Reference

Jan's Model API is compatible with [OpenAI's Models API](https://platform.openai.com/docs/api-reference/models), with additional methods for managing and running models locally.

See [Jan Models API](https://jan.ai/api-reference#tag/Models).

## Importing Models

:::caution

This is currently under development.

:::

You can import a model by dragging the model binary or gguf file into the `/models` folder.

- Jan automatically generates a corresponding `model.json` file based on the binary filename.
- Jan automatically organizes it into its own `/models/model-id` folder.
- Jan automatically populates the `model.json` properties, which you can subsequently modify.

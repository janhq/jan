---
title: "Models"
---

Models are AI models like Llama and Mistral

> OpenAI Equivalent: https://platform.openai.com/docs/api-reference/models

## Model Object

- `model.json`

> Equivalent to: https://platform.openai.com/docs/api-reference/models/object

```json=
{
    // OpenAI model compatibility
    // https://platform.openai.com/docs/api-reference/models)
    "id": "llama-2-uuid",
    "object": "model",
    "created": 1686935002,
    "owned_by": "you"

    // Model settings (benchmark: Ollama)
    // https://github.com/jmorganca/ollama/blob/main/docs/modelfile.md#template
    "model_name": "llama2",
    "model_path": "ROOT/models/...",
    "parameters": {
        "temperature": "..",
        "token-limit": "..",
        "top-k": "..",
        "top-p": ".."
    },
    "template": "This is a full prompt template",
    "system": "This is a system prompt",

    // Model metadata (benchmark: HuggingFace)
    "version": "...",
    "author": "...",
    "tags": "...",
    ...
}
```

## Model API

See [/model](/api/model)

- Equivalent to: https://platform.openai.com/docs/api-reference/models

```sh=
GET https://localhost:1337/v1/models             # List models
GET https://localhost:1337/v1/models/{model}     # Get model object
DELETE https://localhost:1337/v1/models/{model}  # Delete model

TODO:
# Start model
# Stop model
```

## Model Filesystem

How `models` map onto your local filesystem

```sh
/janroot
    /models
        /modelA
            model.json         # Default model params
            modelA.gguf
            modelA.bin
        /modelB/*
            model.json
            modelB.gguf
    /assistants
        model.json             # Defines model, default: looks in `/models`
        /models                # Optional /models folder that overrides root
            /modelA
                model.json
                modelA.bin
```

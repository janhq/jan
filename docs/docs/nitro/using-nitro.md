---
title: Quick start
---

## Step 1: Download Nitro

To use Nitro, download the released binaries from the release page below:

🔗 [Download Nitro](https://github.com/janhq/nitro/releases)

After downloading the release, double-click on the Nitro binary.

## Step 2: Download a Model

Download a llama model to try running the llama C++ integration. You can find a "GGUF" model on The Bloke's page below:

🔗 [Download Model](https://huggingface.co/TheBloke)

## Step 3: Run Nitro

Double-click on Nitro to run it. After downloading your model, make sure it's saved to a specific path. Then, make an API call to load your model into Nitro.

```zsh
curl -X POST 'http://localhost:3928/inferences/llamacpp/loadmodel' \
  -H 'Content-Type: application/json' \
  -d '{
    "llama_model_path": "/path/to/your_model.gguf",
    "ctx_len": 2048,
    "ngl": 100,
    "embedding": true
  }'
```

Configure your system by setting the following parameters in your `jsonBody`. The table below outlines each parameter and its description:

| Parameter        | Type    | Description                                                  |
|------------------|---------|--------------------------------------------------------------|
| `llama_model_path` | String  | The file path to the LLaMA model.                            |
| `ngl`              | Integer | The number of GPU layers to use.                             |
| `ctx_len`          | Integer | The context length for the model operations.                 |
| `embedding`        | Boolean | Whether to use embedding in the model.                       |
| `n_parallel`       | Integer | The number of parallel operations. Uses Drogon thread count if not set. |
| `cont_batching`    | Boolean | Whether to use continuous batching.                          |
| `user_prompt`      | String  | The prompt to use for the user.                              |
| `ai_prompt`        | String  | The prompt to use for the AI assistant.                      |
| `system_prompt`    | String  | The prompt to use for system rules.                          |
| `pre_prompt`    | String  | The prompt to use for internal configuration.                          |

## Step 4: Nitro Inference

```zsh
curl --location 'http://localhost:3928/inferences/llamacpp/chat_completion' \
     --header 'Content-Type: application/json' \
     --header 'Accept: text/event-stream' \
     --header 'Access-Control-Allow-Origin: *' \
     --data '{
        "messages": [
            {"content": "Hello there 👋", "role": "assistant"},
            {"content": "Can you write a long story", "role": "user"}
        ],
        "stream": true,
        "model": "gpt-3.5-turbo",
        "max_tokens": 2000
     }'
```

Nitro server is compatible with the OpenAI format, so you can expect the same output as the OpenAI ChatGPT API.
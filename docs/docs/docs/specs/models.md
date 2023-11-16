---
title: "Models"
---

Models are AI models like Llama and Mistral

> OpenAI Equivalent: https://platform.openai.com/docs/api-reference/models

## Model Object
> Equivalent to: https://platform.openai.com/docs/api-reference/models/object

- LOCAL MODEL - 1 binary `model-zephyr-7B.json` - [Reference](https://huggingface.co/TheBloke/zephyr-7B-beta-GGUF/)

```json
# Required
"origin": "TheBloke/zephyr-7B-beta-GGUF"
    
# Optional - by default use `default``
"import_format": "thebloke"
#    default         # downloads the whole thing
#    thebloke        # custom importer (detects from URL)
#    janhq           # Custom importers
#    openai

# optional, by default download model with recommended hardware
"download_url": "zephyr-7b-beta.Q2_K.gguf" - 
# https://huggingface.co/TheBloke/zephyr-7B-beta-GGUF/resolve/main/zephyr-7b-beta.Q2_K.gguf?download=true

# Optional: OpenAI format
"id": {model_file_name}, # No need to specify, only need to return in API
"object": "model",
"created": 1686935002, # Unix timestamp
"owned_by": "TheBloke"

# Optional: params
parameters: {
    "init": {
        "ctx_len": 2048,
        "ngl": 100,
        "embedding": true,
        "n_parallel": 4,
        "pre_prompt": "A chat between a curious user and an artificial intelligence",
        "user_prompt": "USER: ",
        "ai_prompt": "ASSISTANT: "
    },
    "runtime": {
        "temperature": "0.7",
        "token_limit": "2048",
        "top_k": "",
        "top_p": "..",
    }
}

// Jan specific configs
"metadata": {               // @Q: should we put all under "jan"
    "engine": "llamacpp",               // enum[llamacpp,api]
}
```

- LOCAL MODEL - multiple binaries `model-llava-v1.5-ggml.json` [Reference](https://huggingface.co/mys/ggml_llava-v1.5-13b)

```json
# Required

"origin": "mys/ggml_llava-v1.5-13b"
    
# Optional - by default use `default``
"import_format": "default"
#    default         # downloads the whole thing
#    thebloke        # custom importer (detects from URL)
#    janhq           # Custom importers
#    openai

# Optional: OpenAI format
"id": {model_file_name}, # No need to specify, only need to return in API"object": "model",
"created": 1686935002, 
"owned_by": "TheBloke"

# Optional: params
parameters: {
    "init": {
        "ctx_len": 2048,
        "ngl": 100,
        "embedding": true,
        "n_parallel": 4,
        "pre_prompt": "A chat between a curious user and an artificial intelligence",
        "user_prompt": "USER: ",
        "ai_prompt": "ASSISTANT: "
    },
    "runtime": {
        "temperature": "0.7",
        "token_limit": "2048",
        "top_k": "",
        "top_p": "..",
    }
}

// Jan specific configs
"metadata": {               // @Q: should we put all under "jan"
    "engine": "llamacpp",               // enum[llamacpp,api]
}
```

- REMOTE MODEL `model-azure-openai-gpt4-turbo.json` - [Reference](https://learn.microsoft.com/en-us/azure/ai-services/openai/)quickstart?tabs=command-line%2Cpython&pivots=rest-api

```json
# Required
"origin": "https://docs-test-001.openai.azure.com/" 
# This is `api.openai.com` if it's OpenAI platform
    
# Optional - by default use `default``
import_format: azure_openai
#    default         # downloads the whole thing
#    thebloke        # custom importer (detects from URL)
#    janhq           # Custom importers
#    azure_openai    # Custom importers
#    openai          # Custom importers

# Optional: OpenAI format
"id": "/openai.azure.com/docs-test-001/gpt4-turbo", # Autofilled by Jan with required URL above 
"object": "model",
"created": 1686935002, 
"owned_by": "OpenAI Azure"

# Optional: params
# This is the one model gets configured and cannot be changed by assistant

parameters: {
    "init": {
        "API-KEY": "",
        "DEPLOYMENT-NAME": "",
        "api-version": "2023-05-15"
    },
    "runtime": {
        "temperature": "0.7",
        "max_tokens": "2048",
        "presence_penalty": "0",
        "top_p": "1",
        "stream": "true"
    }
}

// Jan specific configs
"metadata": {               // @Q: should we put all under "jan"
    "engine": "api",               // enum[llamacpp,api]
}
```

## Model API
See [/model](/api/model)

- Equivalent to: https://platform.openai.com/docs/api-reference/models

```sh
# List models
GET https://localhost:1337/v1/models?filter=[enum](all,running,downloaded,downloading)
List[model_object]

# Get model object
GET https://localhost:1337/v1/models/{model_id} # json file name as {model_id} model-azure-openai-gpt4-turbo, model-zephyr-7B
model_object

# Delete model
DELETE https://localhost:1337/v1/models/{model_id} # json file name as {model_id} model-azure-openai-gpt4-turbo, model-zephyr-7B

# Stop model
PUT https://localhost:1337/v1/models/{model_id}/stop # json file name as {model_id} model-azure-openai-gpt4-turbo, model-zephyr-7B

# Start model
PUT https://localhost:1337/v1/models/{model_id}/start # json file name as {model_id} model-azure-openai-gpt4-turbo, model-zephyr-7B
{
  "id": [string] # The model name to be used in `chat_completion` = model_id
  "model_parameters": [jsonPayload],
  "engine": [enum](llamacpp,openai)
}
```

## Model Filesystem

How `models` map onto your local filesystem

```shell=
/janroot
    /models
        azure-openai/
            azure-openai-gpt3-5.json

        llama2-70b/
            model.json
            .gguf
        
        llama2-7b-gguf/
            llama2-7b-gguf-Q2.json
            llama2-7b-gguf-Q3_K_L.json
            .bin
        
        llava-ggml/
            llava-ggml-Q5.json
            .proj
            ggml
        
        llama-70b-finetune
            llama-70b-finetune-q5.json
            .bin
```

- Test cases
    1. If user airdrop model, drag and drop to Jan (bin + json file), Jan can pick up and use
    2. If user have fine tuned model, same as step 1
    3. If user have 1 model that needs multiple binaries 
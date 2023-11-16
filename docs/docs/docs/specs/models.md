---
title: "Models"
---

Models are AI models like Llama and Mistral

> OpenAI Equivalent: https://platform.openai.com/docs/api-reference/models

## Model Object

- LOCAL MODEL `model-zephyr-7B.json` 
  - Reference: https://huggingface.co/TheBloke/zephyr-7B-beta-GGUF/

> Equivalent to: https://platform.openai.com/docs/api-reference/models/object

```sh=
# Required

"url": TheBloke/zephyr-7B-beta-GGUF
    
# Optional - by default use `default``
import_format: thebloke
#    default         # downloads the whole thing
#    thebloke        # custom importer (detects from URL)
#    janhq           # Custom importers
#    openai
"default_download": zephyr-7b-beta.Q2_K.gguf # optional, by default download model with recommended hardware

# Optional: OpenAI format
"id": "/huggingface.co/TheBloke/zephyr-7B-beta-GGUF", # Autofilled by Jan with required URL above 
"object": "model",
"created": 1686935002, 
"owned_by": "TheBloke"

# Optional: params
"init_parameters": {
    "ctx_len": 2048,
    "ngl": 100,
    "embedding": true,
    "n_parallel": 4,
    "pre_prompt": "A chat between a curious user and an artificial intelligence",
    "user_prompt": "USER: ",
    "ai_prompt": "ASSISTANT: "
},

"runtime_parameters": {
    "temperature": "0.7",
    "token_limit": "2048",
    "top_k": "",
    "top_p": "..",
}

// Jan specific configs
"metadata": {               // @Q: should we put all under "jan"
    "engine": "api",               // enum[llamacpp,api]
}
```

- REMOTE MODEL `model-azure-openai-gpt4-turbo.json` 
  - Reference: https://learn.microsoft.com/en-us/azure/ai-services/openai/quickstart?tabs=command-line%2Cpython&pivots=rest-api

> Equivalent to: https://platform.openai.com/docs/api-reference/models/object

```sh=
# Required

"url": https://docs-test-001.openai.azure.com/ # This is `api.openai.com` if it's OpenAI platform
    
# Optional - by default use `default``
import_format: azure_openai
#    default         # downloads the whole thing
#    thebloke        # custom importer (detects from URL)
#    janhq           # Custom importers
#    azure_openai    # Custom importers
#    openai          # Custom importers
"default_download": zephyr-7b-beta.Q2_K.gguf # optional, by default download model with recommended hardware

# Optional: OpenAI format
"id": "/openai.azure.com/docs-test-001/gpt4-turbo", # Autofilled by Jan with required URL above 
"object": "model",
"created": 1686935002, 
"owned_by": "OpenAI Azure"

# Optional: params
# This is the one model gets configured and cannot be changed by assistant
"init_parameters": {
    "API-KEY": "",
    "DEPLOYMENT-NAME": "",
    "api-version": "2023-05-15"
},

# This is the one that assistant can override
"runtime_parameters": {
    "temperature": "0.7",
    "max_tokens": "2048",
    "presence_penalty": "0",
    "top_p": "1",
    "stream": "true"
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
  "engine": [enum](llamacpp)
}
```

## Model Filesystem

How `models` map onto your local filesystem

```shell=
/janroot
    /models
        llama2-70b.json
        llama2-7b-gguf.json
        
        huggingface.co/ # Model registries (de-factor open source)
            meta-llama/
                llama2-70b-chat-hf/
                llama2-7b-chat/
            thebloke/
                llama2-70b-chat-hf-gguf/
                llama2-7b-chat/
                    llama7b_q2_K_L.gguf
                    llama7b_q3_K_L.gguf
        model.louis.ai/ # Private model registries
            meta-llama/
                llama2-70b-chat-hf-tensorrt-llm/
                llama2-70b-chat-hf-awq/
                    model.json
            thebloke/
                llava-1-5-gguf/ # Use case with multiple model 
                    mmproj.bin
                    model-q5.ggml
                    
        llama-70b-finetune.bin
        llama-70b-finetune.json
```
---
title: "Models"
---

:::warning

Draft Specification: functionality has not been implemented yet. 

Feedback: [HackMD: Models Spec](https://hackmd.io/ulO3uB1AQCqLa5SAAMFOQw) 

:::

Models are AI models like Llama and Mistral

> OpenAI Equivalent: https://platform.openai.com/docs/api-reference/models

## User Stories

_Users can download a model via a web URL_

- Wireframes here

_Users can import a model from local directory_

- Wireframes here

_Users can configure model settings, like run parameters_

- Wireframes here

_Users can override run settings at runtime_

- See Assistant Spec and Thread

## Jan Model Object

- A `Jan Model Object` is a “representation" of a model
- Objects are defined by `model-name.json` files in `json` format
- Objects are identified by `folder-name/model-name`, where its `id` is indicative of its file location.
- Objects are designed to be compatible with `OpenAI Model Objects`, with additional properties needed to run on our infrastructure.
- ALL object properties are optional, i.e. users should be able to run a model declared by an empty `json` file.

| Property                | Type                                                          | Description                                                               | Validation                                       |
| ----------------------- | ------------------------------------------------------------- | ------------------------------------------------------------------------- | ------------------------------------------------ |
| `source_url`            | string                                                        | The model download source. It can be an external url or a local filepath. | Defaults to `pwd`. See [Source_url](#Source_url) |
| `object`                | enum: `model`, `assistant`, `thread`, `message`               | Type of the Jan Object. Always `model`                                    | Defaults to "model"                              |
| `name`                  | string                                                        | A vanity name                                                             | Defaults to filename                             |
| `description`           | string                                                        | A vanity description of the model                                         | Defaults to ""                                   |
| `state`                 | enum[`running` , `stopped`, `not-downloaded` , `downloading`] | Needs more thought                                                        | Defaults to `not-downloaded`                     |
| `parameters`            | map                                                           | Defines default model run parameters used by any assistant.               | Defaults to `{}`                                 |
| `metadata`              | map                                                           | Stores additional structured information about the model.                 | Defaults to `{}`                                 |
| `metadata.engine`       | enum: `llamacpp`, `api`, `tensorrt`                           | The model backend used to run model.                                      | Defaults to "llamacpp"                           |
| `metadata.quantization` | string                                                        | Supported formats only                                                    | See [Custom importers](#Custom-importers)        |
| `metadata.binaries`     | array                                                         | Supported formats only.                                                   | See [Custom importers](#Custom-importers)        |

### Source_url

- Users can download models from a `remote` source or reference an existing `local` model.
- If this property is not specified in the Model Object file, then the default behavior is to look in the current directory.

#### Local source_url

- Users can import a local model by providing the filepath to the model

```json
// ./models/llama2/llama2-7bn-gguf.json
"source_url": "~/Downloads/llama-2-7bn-q5-k-l.gguf",

// Default, if property is omitted
"source_url": "./",
```

#### Remote source_url

- Users can download a model by remote URL.
- Supported url formats:
  - `https://huggingface.co/TheBloke/Llama-2-7B-Chat-GGUF/blob/main/llama-2-7b-chat.Q3_K_L.gguf`
  - `https://any-source.com/.../model-binary.bin`

#### Custom importers

Additionally, Jan supports importing popular formats. For example, if you provide a HuggingFace URL for a `TheBloke` model, Jan automatically downloads and catalogs all quantizations. Custom importers autofills properties like `metadata.quantization` and `metadata.size`.

Supported URL formats with custom importers:

- `huggingface/thebloke`: `TODO: URL here`
- `janhq`: `TODO: put URL here`
- `azure_openai`: `TODO: put URL here`
- `openai`: `TODO: put URL here`

### Generic Example

- Model has 1 binary `model-zephyr-7B.json`
- See [source](https://huggingface.co/TheBloke/zephyr-7B-beta-GGUF/)

```json
// ./models/zephr/zephyr-7b-beta-Q4_K_M.json
// Note: Default fields omitted for brevity
"source_url": "https://huggingface.co/TheBloke/zephyr-7B-beta-GGUF/blob/main/zephyr-7b-beta.Q4_K_M.gguf",
"parameters": {
    "ctx_len": 2048,
    "ngl": 100,
    "embedding": true,
    "n_parallel": 4,
    "pre_prompt": "A chat between a curious user and an artificial intelligence",
    "user_prompt": "USER: ",
    "ai_prompt": "ASSISTANT: "
    "temperature": "0.7",
    "token_limit": "2048",
    "top_k": "..",
    "top_p": "..",
},
"metadata": {
    "quantization": "..",
    "size": "..",
}
```

### Example: multiple binaries

- Model has multiple binaries
- See [source](https://huggingface.co/mys/ggml_llava-v1.5-13b)

```json
"source_url": "https://huggingface.co/mys/ggml_llava-v1.5-13b"
"metadata": {
    "binaries": "..", // TODO: what should this property be
}
```

### Example: Azure API

- Using a remote API to access model
- See [source](https://learn.microsoft.com/en-us/azure/ai-services/openai/quickstart?tabs=command-line%2Cpython&pivots=rest-api)

```json
"source_url": "https://docs-test-001.openai.azure.com/openai.azure.com/docs-test-001/gpt4-turbo",
"parameters": {
    "API-KEY": "",
    "DEPLOYMENT-NAME": "",
    "api-version": "2023-05-15",
    "temperature": "0.7",
    "max_tokens": "2048",
    "presence_penalty": "0",
    "top_p": "1",
    "stream": "true"
}
"metadata": {
    "engine": "api",
}
```

## Filesystem

- Everything needed to represent a `model` is packaged into an `Model folder`.
- The `folder` is standalone and can be easily zipped, imported, and exported, e.g. to Github.
- The `folder` always contains at least one `Model Object`, declared in a `json` format.
  - The `folder` and `file` do not have to share the same name
- The model `id` is made up of `folder_name/filename` and is thus always unique.

```sh
/janroot
    /models
        azure-openai/                       # Folder name
            azure-openai-gpt3-5.json        # File name

        llama2-70b/
            model.json
            .gguf
```

### Default ./model folder

- Jan ships with a default model folders containing recommended models
- Only the Model Object `json` files are included
- Users must later explicitly download the model binaries

```sh
models/
    mistral-7b/
        mistral-7b.json
    hermes-7b/
        hermes-7b.json
```

### Multiple quantizations

- Each quantization has its own `Jan Model Object` file

```sh
llama2-7b-gguf/
    llama2-7b-gguf-Q2.json
    llama2-7b-gguf-Q3_K_L.json
    .bin
```

### Multiple model partitions

- A Model that is partitioned into several binaries use just 1 file

```sh
llava-ggml/
    llava-ggml-Q5.json
    .proj
    ggml
```

### ?? whats this example for?

- ??

```sh
llama-70b-finetune/
    llama-70b-finetune-q5.json
    .bin
```

## Jan API

### Model API Object

- The `Jan Model Object` maps into the `OpenAI Model Object`.
- Properties marked with `*` are compatible with the [OpenAI `model` object](https://platform.openai.com/docs/api-reference/models)
- Note: The `Jan Model Object` has additional properties when retrieved via its API endpoint.
- https://platform.openai.com/docs/api-reference/models/object

| Property      | Type           | Public Description                                          | Jan Model Object (`m`) Property              |
| ------------- | -------------- | ----------------------------------------------------------- | -------------------------------------------- |
| `id`\*        | string         | Model uuid; also the file location under `/models`          | `folder/filename`                            |
| `object`\*    | string         | Always "model"                                              | `m.object`                                   |
| `created`\*   | integer        | Timestamp when model was created.                           | `m.json` creation time                       |
| `owned_by`\*  | string         | The organization that owns the model.                       | grep author from `m.source_url` OR $(whoami) |
| `name`        | string or null | A display name                                              | `m.name` or filename                         |
| `description` | string         | A vanity description of the model                           | `m.description`                              |
| `state`       | enum           |                                                             |                                              |
| `parameters`  | map            | Defines default model run parameters used by any assistant. |                                              |
| `metadata`    | map            | Stores additional structured information about the model.   |                                              |

### List models

- https://platform.openai.com/docs/api-reference/models/list

TODO: @hiro

### Get Model

- https://platform.openai.com/docs/api-reference/models/retrieve

TODO: @hiro

### Delete Model

- https://platform.openai.com/docs/api-reference/models/delete

TODO: @hiro

### Get Model State

> Jan-only endpoint
> TODO: @hiro

### Get Model Metadata

> Jan-only endpoint
> TODO: @hiro

### Download Model

> Jan-only endpoint
> TODO: @hiro

### Start Model

> Jan-only endpoint
> TODO: @hiro

### Stop Model

> Jan-only endpoint
> TODO: @hiro

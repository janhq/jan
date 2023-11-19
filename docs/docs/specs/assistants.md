---
title: "Assistants"
---

Assistants can use models and tools.
> OpenAI Equivalent: https://platform.openai.com/docs/api-reference/assistants
- Jan's `Assistants` are even more powerful than OpenAI due to customizable code in `index.js`

## User Stories

_Users can download an assistant via a web URL_

- Wireframes here

_Users can import an assistant from local directory_

- Wireframes here

_Users can configure assistant settings_

- Wireframes here

## Assistant Object

- `assistant.json`
> OpenAI Equivalen: https://platform.openai.com/docs/api-reference/assistants/object

```json
{
  // Jan specific properties
  "avatar": "https://lala.png",
  "thread_location": "ROOT/threads",  // Default to root (optional field)
  // TODO: add moar

  // OpenAI compatible properties: https://platform.openai.com/docs/api-reference/assistants
  "id": "asst_abc123",
  "object": "assistant",
  "created_at": 1698984975,
  "name": "Math Tutor",
  "description": null,
  "instructions": "...",
  "tools": [
    {
      "type": "retrieval"
    },
    {
      "type": "web_browsing"
    }
  ],
  "file_ids": ["file_id"],
  "models": ["<model_id>"],
  "metadata": {}
}
```

### Assistant lifecycle
Assistant has 4 states (enum)
- `to_download`
- `downloading`
- `ready`
- `running`

## Assistants API

- What would modifying Assistant do? (doesn't mutate `index.js`?)
  - By default, `index.js` loads `assistant.json` file and executes exactly like so. This supports builders with little time to write code.
  - The `assistant.json` is 1 source of truth for the definitions of `models` and `built-in tools` that they can use it without writing more code.

### Get list assistants
> OpenAI Equivalent: https://platform.openai.com/docs/api-reference/assistants/listAssistants
- Example request
```shell
  curl {JAN_URL}/v1/assistants?order=desc&limit=20 \
    -H "Content-Type: application/json"
```
- Example response
```json
{
  "object": "list",
  "data": [
    {
      "id": "asst_abc123",
      "object": "assistant",
      "created_at": 1698982736,
      "name": "Coding Tutor",
      "description": null,
      "models": ["model_zephyr_7b", "azure-openai-gpt4-turbo"],
      "instructions": "You are a helpful assistant designed to make me better at coding!",
      "tools": [],
      "file_ids": [],
      "metadata": {},
      "state": "ready"
    },
  ],
  "first_id": "asst_abc123",
  "last_id": "asst_abc789",
  "has_more": false
}
```

### Get assistant
> OpenAI Equivalent: https://platform.openai.com/docs/api-reference/assistants/getAssistant
- Example request
```shell
  curl {JAN_URL}/v1/assistants/{assistant_id}   \
    -H "Content-Type: application/json"
```
- Example response
```json
{
  "id": "asst_abc123",
  "object": "assistant",
  "created_at": 1699009709,
  "name": "HR Helper",
  "description": null,
  "models": ["model_zephyr_7b", "azure-openai-gpt4-turbo"],
  "instructions": "You are an HR bot, and you have access to files to answer employee questions about company policies.",
  "tools": [
    {
      "type": "retrieval"
    }
  ],
  "file_ids": [
    "file-abc123"
  ],
  "metadata": {},
  "state": "ready"
}
```

### Create an assistant
Create an assistant with models and instructions.
> OpenAI Equivalent: https://platform.openai.com/docs/api-reference/assistants/createAssistant
- Example request
```shell
  curl -X POST {JAN_URL}/v1/assistants   \
    -H "Content-Type: application/json" \
    -d {
      "instructions": "You are a personal math tutor. When asked a question, write and run Python code to answer the question.",
      "name": "Math Tutor",
      "tools": [{"type": "retrieval"}],
      "model": ["model_zephyr_7b", "azure-openai-gpt4-turbo"]
    }
```
- Example response
```json
{
  "id": "asst_abc123",
  "object": "assistant",
  "created_at": 1698984975,
  "name": "Math Tutor",
  "description": null,
  "model": ["model_zephyr_7b", "azure-openai-gpt4-turbo"]
  "instructions": "You are a personal math tutor. When asked a question, write and run Python code to answer the question.",
  "tools": [
    {
      "type": "retrieval"
    }
  ],
  "file_ids": [],
  "metadata": {},
  "state": "ready"
}
```
### Modify an assistant
> OpenAI Equivalent: https://platform.openai.com/docs/api-reference/assistants/modifyAssistant
- Example request
```shell
  curl -X POST {JAN_URL}/v1/assistants/{assistant_id}   \
    -H "Content-Type: application/json" \
    -d {
      "instructions": "You are a personal math tutor. When asked a question, write and run Python code to answer the question.",
      "name": "Math Tutor",
      "tools": [{"type": "retrieval"}],
      "model": ["model_zephyr_7b", "azure-openai-gpt4-turbo"]
    }
```
- Example response
```json
{
  "id": "asst_abc123",
  "object": "assistant",
  "created_at": 1698984975,
  "name": "Math Tutor",
  "description": null,
  "model": ["model_zephyr_7b", "azure-openai-gpt4-turbo"]
  "instructions": "You are a personal math tutor. When asked a question, write and run Python code to answer the question.",
  "tools": [
    {
      "type": "retrieval"
    }
  ],
  "file_ids": [],
  "metadata": {},
  "state": "ready"
}
```
### Delete Assistant
> OpenAI Equivalent: https://platform.openai.com/docs/api-reference/assistants/deleteAssistant
`- Example request
```shell
curl -X DELETE {JAN_URL}/v1/assistant/model-zephyr-7B
```
- Example response
```json
{
  "id": "asst_abc123",
  "object": "assistant.deleted",
  "deleted": true,
  "state": "to_download"
}
```

## Assistants Filesystem

```sh
/assistants
    /jan
        assistant.json    # Assistant configs (see below)

        # For any custom code
        package.json      # Import npm modules
                          # e.g. Langchain, Llamaindex
        /src              # Supporting files (needs better name)
            index.js      # Entrypoint
            process.js    # For electron IPC processes (needs better name)

        # `/threads` at root level
        # `/models` at root level
    /shakespeare
        assistant.json
        package.json
        /src
            index.js
            process.js

        /threads          # Assistants remember conversations in the future
        /models           # Users can upload custom models
            /finetuned-model
```

---
title: "Assistants"
---

Assistants can use models and tools.

- Jan's `Assistants` are even more powerful than OpenAI due to customizable code in `index.js`

> OpenAI Equivalent: https://platform.openai.com/docs/api-reference/assistants

## Assistant Object

- `assistant.json`
- Equivalent to: https://platform.openai.com/docs/api-reference/assistants/object

```json
{
  // Jan specific properties
  "avatar": "https://lala.png"
  "thread_location": "ROOT/threads"  // Default to root (optional field)
  // TODO: add moar

  // OpenAI compatible properties: https://platform.openai.com/docs/api-reference/assistants
  "id": "asst_abc123",
  "object": "assistant",
  "created_at": 1698984975,
  "name": "Math Tutor",
  "description": null,
  "model": reference model.json,
  "instructions": reference model.json,
  "tools": [
    {
      "type": "rag"
    }
  ],
  "file_ids": [],
  "metadata": {}
}
```

## Assistants API

- _TODO_: What would modifying Assistant do? (doesn't mutate `index.js`?)

```sh
GET https://api.openai.com/v1/assistants                       # List
POST https://api.openai.com/v1/assistants                      # C
GET https://api.openai.com/v1/assistants/{assistant_id}        # R
POST https://api.openai.com/v1/assistants/{assistant_id}       # U
DELETE https://api.openai.com/v1/assistants/{assistant_id}     # D
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
        model.json        # Creator chooses model and settings
        package.json
        /src
            index.js
            process.js

        /threads          # Assistants remember conversations in the future
        /models           # Users can upload custom models
            /finetuned-model
```

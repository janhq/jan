---
title: "Assistants"
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

In Jan, assistants are `primary` entities with the following capabilities:

- Assistants can use `models`, `tools`, handle and emit `events`, and invoke `custom code`.
- Users can create custom assistants with saved `model` settings and parameters.
- An [OpenAI Assistants API](https://platform.openai.com/docs/api-reference/assistants) compatible endpoint at `localhost:1337/v1/assistants`.
- Jan ships with a default assistant called "Jan" that lets you use all models.

## Folder Structure

```yaml
/jan
    /models/
    /threads/
    /assistants
        /jan                  # An assistant available to you by default
            assistant.json    # See below
            /src              # Assistants can invoke custom code
                index.js      # Entrypoint
                process.js    # For server processes (needs better name)
            package.json      # Import any npm libraries, e.g. Langchain, Llamaindex
        /shakespeare          # You can create custom assistants
            assistant.json
        /chicken_man
```

## `assistant.json`

- Each `assistant` folder contains an `assistant.json` file, which is a representation of an assistant.
- `assistant.json` contains metadata and model parameter overrides
- There are no required fields.

```js
{
  "id": "asst_abc123",                // Defaults to foldername
  "object": "assistant",              // Always "assistant"
  "version": 1,                       // Defaults to 1
  "created_at": 1698984975,
  "name": "Math Tutor",               // Defaults to foldername
  "description": null,
  "avatar": "https://pic.png",
  "models": [                         // Defaults to "*" all models
      { ...model_0 }
  ],
  "instructions": "Be concise",       // A system prompt for the assistant
  "events": [],                       // Defaults to "*"
  "metadata": {},                     // Defaults to {}
  // "tools": [],                     // Coming soon
  // "file_ids": [],                  // Coming soon
  // "memory/threads": true,          // Coming soon
}
```

### Examples

Here's what the default Jan assistant's json file looks like:

```js
{
  "name": "Jan",
  "description": "A global assistant that lets you chat with all downloaded models",
  "avatar": "https://jan.ai/img/logo.svg",
  // All other properties are not explicitly declared and use the default values (see above).
}
```

## Events

Jan assistants can respond to event hooks. More powerfully, Jan assistants can register their own pubsub, so other entities, like other assistants can respond to your assistants events.

## Custom Code

Jan assistants are Turing complete. This means you can write freeform code, and use any dependencies, when customizing your assistant.

```typescript
import {events, models} from "@janhq/core"
import {retrieval} from "@hiro/best-rag-ever" // This can be featured on Jan hub but install from npm

events.on('assistant:asst_abc123', (event) => async {
    const result = models[0].process(event)
    events.emit("assistant:asst_abc123", result)
    resolve()
})
```

## Tools

> Coming soon

## Functions

> Coming soon

## Files

> Coming soon

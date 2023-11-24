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

// KIV 
```shell=
/$JANROOT
    /models
    /assistants  
        /jarvis      # git push http://github.com/abentlen/jarvis
            # TODO: n assistant to multiple assistants
            /threads # Package threads with your Assistant
    /threads
```

- Packaging
    - An Assistant folder

```json
{
  // Jan specific properties
  "avatar": "https://lala.png",

  // OpenAI compatible properties: https://platform.openai.com/docs/api-reference/assistants
  "id": "asst_abc123",
  "object": "assistant",
  "version": 1,
  "created_at": 1698984975,
  "name": "Math Tutor", // required
  "description": null,
  // This one omitted from assistant.json but will be covered in API
  // "instructions": "", // This is openAI compatible. But it should be passed to model[i] as LLM model
  // "tools": [
  //   {
  //     "type": "retrieval"
  //   },
  //   {
  //     "type": "web_browsing"
  //   }
  // ],
  // "file_ids": [],
  // "memory": true,
  // Persistent Memory (remembers all threads, files)
  // if False, then files, etc are stored at /thread level
  "models": "*",    // Jan - model picker (Default)
  // v2
  // If model is specified, then use the below
  // omitted means default
  "models": [
      { "model_id": "", ..., "parameters": {} }
      // v2 { "model_id": "", ... }
  ],
  // The idea here is for explicitly subscribing to event stream
  // v3 
  "events"*: {
      "in": ["assistant:asst_abc123", "jan:*"],
      "out": ["assistant:asst_abc123", "jan:*"]
  },
  // Alternate: Simplified version?
  "events": "*",
  "events": [
      "onMessage",
      "onThread",
      { id: "onMessage", type: "out" } // Event configs
  ]
  // "threads": [<thread_folder_id>]  // Helpful for look up under ~/jan/thread/*
  "metadata": {}
}
```

### Assistant example src/index.ts
```typescript
import {events, models} from "@janhq/core"
import {retrieval} from "@hiro/best-rag-ever" // This can be featured on Jan hub but install from npm

events.on('assistant:asst_abc123', (event) => async {
    const result = models[0].process(event)
    events.emit("assistant:asst_abc123", result)
    resolve()
})
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

### Get assistant
> OpenAI Equivalent: https://platform.openai.com/docs/api-reference/assistants/getAssistant

### Create an assistant
Create an assistant with models and instructions.
> OpenAI Equivalent: https://platform.openai.com/docs/api-reference/assistants/createAssistant

### Modify an assistant
> OpenAI Equivalent: https://platform.openai.com/docs/api-reference/assistants/modifyAssistant

### Delete Assistant
> OpenAI Equivalent: https://platform.openai.com/docs/api-reference/assistants/deleteAssistant

## Assistants Filesystem

```shell
/jan
    /models/
    /threads/
        threads-1/   # jan
        thread-<>/   # chicken
        thread-2/    # multi-assistant (v22)
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
            /threads # if developer specifies
        /chicken
```

### Example
- Jan Assistant json
TBU
- Custom assistant json










## Swagger file

```yaml
AssistantObject:
  type: object
  properties:
    avatar:
      type: string
      description: "URL of the assistant's avatar. Jan-specific property."
      example: "https://lala.png"
    id:
      type: string
      description: "The identifier of the assistant."
      example: "asst_abc123"
    object:
      type: string
      description: "Type of the object, indicating it's an assistant."
      default: "assistant"
    version:
      type: integer
      description: "Version number of the assistant."
      example: 1
    created_at:
      type: integer
      format: int64
      description: "Unix timestamp representing the creation time of the assistant."
    name:
      type: string
      description: "Name of the assistant."
      example: "Math Tutor"
    description:
      type: string
      description: "Description of the assistant. Can be null."
    models:
      type: array
      description: "List of models associated with the assistant. Jan-specific property."
      items:
        type: object
        properties:
          model_id:
            type: string
          # Additional properties for models can be added here
    events:
      type: object
      description: "Event subscription settings for the assistant."
      properties:
        in:
          type: array
          items:
            type: string
        out:
          type: array
          items:
            type: string
      # If there are specific event types, they can be detailed here
    metadata:
      type: object
      description: "Metadata associated with the assistant."
  required:
    - name
    - models
    - events
```
---
title: Introduction
---

Jan can be used to build a variety of AI use cases, at every level of the stack:

- An OpenAI compatible API, with feature parity for `models`, `assistants`, `files` and more
- A standard data format on top of the user's local filesystem, allowing for transparency and composability
- Automatically package and distribute to Mac, Windows and Linux. Cloud coming soon
- An UI kit to customize user interactions with `assistants` and more
- A standalone inference engine for low level use cases

## Resources

<!-- (@Rex: to add some quickstart tutorials) -->

- Create an AI assistant
- Run an OpenAI compatible API endpoint
- Build a VSCode plugin with a local model
- Build a Jan platform module

## Key Concepts

### Modules

- Modules are modular, atomic implementations of a single OpenAI-compatible endpoint
- Modules can be swapped out for alternate implementations
  - The default `messages` module persists messages in thread-specific `.json`
  - `messages-postgresql` uses Postgres for production-grade cloud-native environments

| Jan Module | Description   | API Docs                     |
| ---------- | ------------- | ---------------------------- |
| Chat       | Inference     | [/chat](/api/chat)           |
| Models     | Models        | [/model](/api/model)         |
| Assistants | Apps          | [/assistant](/api/assistant) |
| Threads    | Conversations | [/thread](/api/thread)       |
| Messages   | Messages      | [/message](/api/message)     |

### Local Filesystem

- Jan runs on top of standard structure of local files on user's filesystem
- This allows for composability and tinkerability

```sh=
/janroot               # Jan's root folder (e.g. ~/jan)
    /models            # For raw AI models
    /threads           # For conversation history
    /assistants        # For AI assistants' configs, knowledge, etc.
```

```sh=
/models
    /modelA
        model.json        # Default model settings
        llama-7b-q4.gguf  # Model binaries
        llama-7b-q5.gguf  # Include different quantizations
/threads
    /jan-unixstamp-salt
        model.json        # Overrides assistant/model-level model settings
        thread.json       # thread metadata (e.g. subject)
        messages.json     # messages
        content.json      # What is this?
        files/            # Future for RAG
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

### Jan: a "global" assistant

Jan provides `/jan`, a default assistant that is available to users out-of-the-box. It is a generic assistant to illustrate power of Jan. In the future, it will support additional features e.g. multi-assistant conversations

- Your Assistant "Jan" lets you pick any model that is in the root /models folder
- Right panel: pick LLM model and set model parameters
- Jan’s threads will be at root level
- `model.json` will reflect model chosen for that session
- Be able to “add” other assistants in the future
- Jan’s files will be at thread level
- Jan is not a persistent memory assistant

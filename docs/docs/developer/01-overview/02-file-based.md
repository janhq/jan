---
title: File-based Approach
slug: /developer/file-based
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

:::warning

This page is still under construction, and should be read as a scratchpad

:::

Jan use the local filesystem for data persistence, similar to VSCode. This allows for composability and tinkerability.

```yaml
janroot/               # Jan's root folder (e.g. ~/jan)
    models/            # For raw AI models
    threads/           # For conversation history
    assistants/        # For AI assistants' configs, knowledge, etc.
```

```yaml
/models
    /modelA
        model.json        # Default model settings
        llama-7b-q4.gguf  # Model binaries
/threads
    /jan-unixstamp
        thread.json       # thread metadata (e.g. subject)
        messages.jsonl    # messages
        files/            # RAG
/assistants
    /jan                  # A default assistant that can use all models
        assistant.json    # Assistant configs (see below)
        package.json      # Import npm modules, e.g. Langchain, Llamaindex
        /src              # For custom code
            index.js      # Entrypoint
                          # `/threads` at root level
                          # `/models` at root level
    /shakespeare          # Example of a custom assistant
        assistant.json
        package.json
        /threads          # Assistants remember conversations in the future
        /models           # Users can upload custom models
```

## Data Dependencies

```mermaid
graph LR
    A1[("A User Integrators")] -->|uses| B1[assistant]
    B1 -->|persist conversational history| C1[("thread A")]
    B1 -->|executes| D1[("built-in tools as module")]
    B1 -.->|uses| E1[model]
    E1 -.->|model.json| D1
    D1 --> F1[retrieval]
    F1 -->|belongs to| G1[("web browsing")]
    G1 --> H1[Google]
    G1 --> H2[Duckduckgo]
    F1 -->|belongs to| I1[("API calling")]
    F1 --> J1[("knowledge files")]
```

- User/ Integrator
- Assistant object
- Model object
- Thread object
- Built-in tool object

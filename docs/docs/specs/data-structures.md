---
title: Data Structures
---


```sh
janroot/
	assistants/
		assistant-a/
			assistant.json
			src/
				index.ts
			threads/
				thread-a/
				thread-b
	models/
		model-a/
			model.json
```



Jan use the local filesystem for data persistence, similar to VSCode. This allows for composability and tinkerability.

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

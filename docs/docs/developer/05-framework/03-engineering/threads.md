---
title: Threads
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

`Threads` are conversations between an `assistant` and the user:

- Users can tweak `model` params and `assistant` behavior within each thread.
- Users can import and export threads.
- An [OpenAI Thread API](https://platform.openai.com/docs/api-reference/threads) compatible endpoint at `localhost:1337/v1/threads`.

## Folder Structure

- Threads are saved in the `/threads` folder.
- Threads are organized by folders, one for each thread, and can be easily zipped, exported, and cleared.
- Thread folders follow the naming: `assistant_id` + `thread_created_at`.
- Thread folders also contain `messages.jsonl` files. See [messages](/docs/engineering/messages).

```yaml
janroot/
    threads/
        assistant_name_unix_timestamp/    # Thread `ID`
            thread.json
```

## `thread.json`

- Each `thread` folder contains a `thread.json` file, which is a representation of a thread.
- `thread.json` contains metadata and model parameter overrides.
- There are no required fields.

### Example

Here's a standard example `thread.json` for a conversation between the user and the default Jan assistant.

```js
"id": "thread_....",                  // Defaults to foldername
"object": "thread",                   // Defaults to "thread"
"title": "funny physics joke",        // Defaults to ""
"assistants": [
  {
    "assistant_id": "jan",            // Defaults to "jan"
    "model": {                        // Defaults to the currently active model (can be changed before thread is begun)
      "id": "...",
      "settings": {},                 // Defaults to and overrides assistant.json's "settings" (and if none, then model.json "settings")
      "parameters": {},               // Defaults to and overrides assistant.json's "parameters" (and if none, then model.json "parameters")
    }
  },
],
"created": 1231231                    // Defaults to file creation time
"metadata": {},                       // Defaults to {}
```

## API Reference

Jan's Threads API is compatible with [OpenAI's Threads API](https://platform.openai.com/docs/api-reference/threads), with additional methods for managing threads locally.

See [Jan Threads API](https://jan.ai/api-reference#tag/Threads).

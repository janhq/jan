---
title: Threads
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
- Thread folders also contain `messages.jsonl` files. See [messages](/specs/messages).

```sh
jan/
    threads/
        assistant_name_unix_timestamp/
            thread.json
            messages.jsonl
        jan_2341243134/
            thread.json
```

## `thread.json`

- Each `thread` folder contains a `thread.json` file, which is a representation of a thread.
- `thread.json` contains metadata and model parameter overrides.
- There are no required fields.

### Example

Here's a standard example `thread.json` for a conversation between the user and the default Jan assistant.

```json
"id": "thread_....",                  // Defaults to foldername
"object": "thread",                   // Defaults to "thread"
"title": "funny physics joke",        // Defaults to ""
"assistants": [
  {
    "assistant_id": "jan",            // Defaults to "jan"
    "model": {                        // Defaults to 1 currently active model (can be changed before thread is begun)
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

See [Jan Threads API](https://jan.ai/api-reference#tag/Threads)

<!-- TODO clean this part up into API -->
<!--
### Get thread

> OpenAI Equivalent: https://platform.openai.com/docs/api-reference/threads/getThread

- Example request

```shell
    curl {JAN_URL}/v1/threads/{thread_id}
```

- Example response

```json
{
  "id": "thread_abc123",
  "object": "thread",
  "created_at": 1699014083,
  "assistants": ["assistant-001"],
  "metadata": {},
  "messages": []
}
```

### Create Thread

> OpenAI Equivalent: https://platform.openai.com/docs/api-reference/threads/createThread

- Example request

```shell
    curl -X POST {JAN_URL}/v1/threads \
    -H "Content-Type: application/json" \
    -d '{
        "messages": [{
            "role": "user",
            "content": "Hello, what is AI?",
            "file_ids": ["file-abc123"]
        }, {
            "role": "user",
            "content": "How does AI work? Explain it in simple terms."
        }]
    }'
```

- Example response

```json
{
  "id": "thread_abc123",
  "object": "thread",
  "created_at": 1699014083,
  "metadata": {}
}
```

### Modify Thread

> OpenAI Equivalent: https://platform.openai.com/docs/api-reference/threads/modifyThread

- Example request

```shell
    curl -X POST {JAN_URL}/v1/threads/{thread_id} \
    -H "Content-Type: application/json" \
    -d '{
        "messages": [{
            "role": "user",
            "content": "Hello, what is AI?",
            "file_ids": ["file-abc123"]
        }, {
            "role": "user",
            "content": "How does AI work? Explain it in simple terms."
        }]
    }'
```

- Example response

```json
{
  "id": "thread_abc123",
  "object": "thread",
  "created_at": 1699014083,
  "metadata": {}
}
```

- https://platform.openai.com/docs/api-reference/threads/modifyThread

### Delete Thread

> OpenAI Equivalent: https://platform.openai.com/docs/api-reference/threads/deleteThread

- Example request

```shell
    curl -X DELETE {JAN_URL}/v1/threads/{thread_id}
```

- Example response

```json
{
  "id": "thread_abc123",
  "object": "thread.deleted",
  "deleted": true
}
```

### List Threads

> This is a Jan-only endpoint, not supported by OAI yet.

- Example request

```shell
    curl {JAN_URL}/v1/threads \
    -H "Content-Type: application/json" \
```

- Example response

```json
[
  {
    "id": "thread_abc123",
    "object": "thread",
    "created_at": 1699014083,
    "assistants": ["assistant-001"],
    "metadata": {},
    "messages": []
  },
  {
    "id": "thread_abc456",
    "object": "thread",
    "created_at": 1699014083,
    "assistants": ["assistant-002", "assistant-002"],
    "metadata": {}
  }
]
```

### Get & Modify `Thread.Assistants`

-> Can achieve this goal by calling `Modify Thread` API

#### `GET v1/threads/{thread_id}/assistants`

-> Can achieve this goal by calling `Get Thread` API

#### `POST v1/threads/{thread_id}/assistants/{assistant_id}`

-> Can achieve this goal by calling `Modify Assistant` API with `thread.assistant[]`

### List `Thread.Messages`

-> Can achieve this goal by calling `Get Thread` API -->
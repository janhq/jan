---
title: Messages
---

:::caution

This is currently under development.

:::

## Overview

`Messages` capture a conversation's content. This can include the content from LLM responses and other metadata from [chat completions](/specs/chats).

- Users and assistants can send multimedia messages.
- An [OpenAI Message API](https://platform.openai.com/docs/api-reference/messages) compatible endpoint at `localhost:3000/v1/messages`.

## Folder Structure

Messages are saved in the `/threads/{thread_id}` folder in `messages.jsonl` files

```sh
jan/
    threads/
        assistant_name_unix_timestamp/
            ...
            messages.jsonl
        jan_2341243134/
            ...
            messages.jsonl
```

## `message.jsonl`

Individual messages are saved in `jsonl` format for indexing purposes.

```json
{...message_2}
{...message_1}
{...message_0}
```

### Examples

Here's a standard example `message` sent from a user.

```json
"id": "0",                            // Sequential or UUID
"object": "thread.message",           // Defaults to "thread.message"
"created_at": 1698983503,
"thread_id": "thread_asdf",           // Defaults to parent thread
"assistant_id": "jan",                // Defaults to parent thread
"role": "user",                  // From either "user" or "assistant"
"content": [
  {
    "type": "text",
    "text": {
      "value": "Hi!?",
      "annotations": []
    }
  }
],
"metadata": {},                       // Defaults to {}
// "run_id": "...",                   // Rather than `run` id abstraction
// "file_ids": [],
```

Here's an example `message` response from an assistant.

```json
"id": "0",                            // Sequential or UUID
"object": "thread.message",           // Defaults to "thread.message"
"created_at": 1698983503,
"thread_id": "thread_asdf",           // Defaults to parent thread
"assistant_id": "jan",                // Defaults to parent thread
"role": "assistant",                  // From either "user" or "assistant"
"content": [
  {
    "type": "text",
    "text": {
      "value": "Hi! How can I help you today?",
      "annotations": []
    }
  }
],
"metadata": {},                       // Defaults to {}
// "run_id": "...",                   // KIV
// "file_ids": [],                    // KIV
```

## API Reference

Jan's `messages` API is compatible with [OpenAI's Messages API](https://platform.openai.com/docs/api-reference/messages), with additional methods for managing messages locally.

See [Jan Messages API](https://jan.ai/api-reference#tag/Messages)

<!-- TODO clean this part up into API -->
<!--
### Get list message

> OpenAI Equivalent: https://platform.openai.com/docs/api-reference/messages/getMessage

- Example request

```shell
  curl {JAN_URL}/v1/threads/{thread_id}/messages/{message_id} \
    -H "Content-Type: application/json"
```

- Example response

```json
{
  "id": "msg_abc123",
  "object": "thread.message",
  "created_at": 1699017614,
  "thread_id": "thread_abc123",
  "role": "user",
  "content": [
    {
      "type": "text",
      "text": {
        "value": "How does AI work? Explain it in simple terms.",
        "annotations": []
      }
    }
  ],
  "file_ids": [],
  "assistant_id": null,
  "run_id": null,
  "metadata": {}
}
```

### Create message

> OpenAI Equivalent: https://platform.openai.com/docs/api-reference/messages/createMessage

- Example request

```shell
  curl -X POST {JAN_URL}/v1/threads/{thread_id}/messages \
    -H "Content-Type: application/json" \
    -d '{
      "role": "user",
      "content": "How does AI work? Explain it in simple terms."
    }'
```

- Example response

```json
{
  "id": "msg_abc123",
  "object": "thread.message",
  "created_at": 1699017614,
  "thread_id": "thread_abc123",
  "role": "user",
  "content": [
    {
      "type": "text",
      "text": {
        "value": "How does AI work? Explain it in simple terms.",
        "annotations": []
      }
    }
  ],
  "file_ids": [],
  "assistant_id": null,
  "run_id": null,
  "metadata": {}
}
```

### Get message

> OpenAI Equivalent: https://platform.openai.com/docs/api-reference/assistants/listAssistants

- Example request

```shell
  curl {JAN_URL}/v1/threads/{thread_id}/messages/{message_id} \
    -H "Content-Type: application/json"
```

- Example response

```json
{
  "id": "msg_abc123",
  "object": "thread.message",
  "created_at": 1699017614,
  "thread_id": "thread_abc123",
  "role": "user",
  "content": [
    {
      "type": "text",
      "text": {
        "value": "How does AI work? Explain it in simple terms.",
        "annotations": []
      }
    }
  ],
  "file_ids": [],
  "assistant_id": null,
  "run_id": null,
  "metadata": {}
}
```

### Modify message

> Jan: TODO: Do we need to modify message? Or let user create new message?

# Get message file

> OpenAI Equivalent: https://api.openai.com/v1/threads/{thread_id}/messages/{message_id}/files/{file_id}

- Example request

```shell
  curl {JAN_URL}/v1/threads/{thread_id}/messages/{message_id}/files/{file_id} \
    -H "Content-Type: application/json"
```

- Example response

```json
{
  "id": "file-abc123",
  "object": "thread.message.file",
  "created_at": 1699061776,
  "message_id": "msg_abc123"
}
```

# List message files

> OpenAI Equivalent: https://api.openai.com/v1/threads/{thread_id}/messages/{message_id}/files

````
- Example request
```shell
  curl {JAN_URL}/v1/threads/{thread_id}/messages/{message_id}/files/{file_id} \
    -H "Content-Type: application/json"
````

- Example response

```json
{
  "id": "file-abc123",
  "object": "thread.message.file",
  "created_at": 1699061776,
  "message_id": "msg_abc123"
}
``` -->

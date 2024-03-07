---
title: Messages
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

`Messages` capture a conversation's content. This can include the content from LLM responses and other metadata from [chat completions](/specs/chats).

- Users and assistants can send multimedia messages.
- An [OpenAI Message API](https://platform.openai.com/docs/api-reference/messages) compatible endpoint at `localhost:1337/v1/messages`.

## Folder Structure

Messages are saved in the `/threads/{thread_id}` folder in `messages.jsonl` files

```yaml
jan/
    threads/
        assistant_name_unix_timestamp/
            thread.json                   # Thread metadata
            messages.jsonl                # Messages are stored in jsonl format
```

## `message.jsonl`

Individual messages are saved in `jsonl` format for indexing purposes.

```js
{...message_2}
{...message_1}
{...message_0}
```

### Examples

Here's a standard example `message` sent from a user.

```js
"id": "0",                            // Sequential or UUID
"object": "thread.message",           // Defaults to "thread.message"
"created_at": 1698983503,
"thread_id": "thread_asdf",           // Defaults to parent thread
"assistant_id": "jan",                // Defaults to parent thread
"role": "user",                       // From either "user" or "assistant"
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
```

Here's an example `message` response from an assistant.

```js
"id": "0",                            // Sequential or UUID
"object": "thread.message",           // Defaults to "thread.message"
"created_at": 1698983503,
"thread_id": "thread_asdf",           // Defaults to parent thread
"assistant_id": "jan",                // Defaults to parent thread
"role": "assistant",                  // From either "user" or "assistant"
"content": [                          // Usually from Chat Completion obj
  {
    "type": "text",
    "text": {
      "value": "Hi! How can I help you today?",
      "annotations": []
    }
  }
],
"metadata": {},                       // Defaults to {}
"usage": {}                           // Save chat completion properties https://platform.openai.com/docs/api-reference/chat/object
```

## API Reference

Jan's `messages` API is compatible with [OpenAI's Messages API](https://platform.openai.com/docs/api-reference/messages), with additional methods for managing messages locally.

See [Jan Messages API](https://jan.ai/api-reference#tag/Messages).

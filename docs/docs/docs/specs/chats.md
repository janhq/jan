---
title: "Chats"
---

:::warning

Draft Specification: functionality has not been implemented yet. 

:::

Chats are essentially inference requests to a model

> OpenAI Equivalent: https://platform.openai.com/docs/api-reference/chat

## Chat Object

- Equivalent to: https://platform.openai.com/docs/api-reference/chat/object

## Chat API

See [/chat](/api/chat)

- Equivalent to: https://platform.openai.com/docs/api-reference/chat

```sh
POST https://localhost:1337/v1/chat/completions

TODO:
# Figure out how to incorporate tools
```

## Chat Filesystem

- Chats will be persisted to `messages` within `threads`
- There is no data structure specific to Chats

---
title: "Threads"
---

Threads contain `messages` history with assistants. Messages in a thread share context.

- Note: For now, threads "lock the model" after a `message` is sent
  - When a new `thread` is created with Jan, users can choose the models
  - Users can still edit model parameters/system prompts
  - Note: future Assistants may customize this behavior
- Note: Assistants will be able to specify default thread location in the future
  - Jan uses root-level threads, to allow for future multi-assistant threads
  - Assistant Y may store threads in its own folder, to allow for [long-term assistant memory](https://github.com/janhq/jan/issues/344)

> OpenAI Equivalent: https://platform.openai.com/docs/api-reference/threads

## Thread Object

- `thread.json`
- Equivalent to: https://platform.openai.com/docs/api-reference/threads/object

```json
{
  // Jan specific properties:
  "summary": "HCMC restaurant recommendations",
  "messages": {see below}

  // OpenAI compatible properties: https://platform.openai.com/docs/api-reference/threads)
  "id": "thread_abc123",
  "object": "thread",
  "created_at": 1698107661,
  "metadata": {}
}
```

## Threads API

- Equivalent to: https://platform.openai.com/docs/api-reference/threads

```sh=
POST https://localhost:1337/v1/threads/{thread_id}   # Create thread
GET https://localhost:1337/v1/threads/{thread_id}    # Get thread
DELETE https://localhost:1337/v1/models/{thread_id}      # Delete thread
```

## Threads Filesystem

```sh
/assistants
    /homework-helper
        /threads                # context is "permanently remembered" by assistant in future conversations
/threads                        # context is only retained within a single thread
```

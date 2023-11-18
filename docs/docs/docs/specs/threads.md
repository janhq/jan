---
title: "Threads"
---

:::warning

Draft Specification: functionality has not been implemented yet. 

Feedback: [HackMD: Threads Spec](https://hackmd.io/BM_8o_OCQ-iLCYhunn2Aug)

:::

## User Stories

_Users can chat with an assistant in a thread_

- See [Messages Spec](./messages.md)

_Users can change assistant and model parameters in a thread_

- Wireframes of

_Users can delete all thread history_

- Wireframes of settings page.

## Jan Thread Object

- A `Jan Thread Object` is a "representation of a conversation thread" between an `assistant` and the user
- Objects are defined by `thread-uuid.json` files in `json` format
- Objects are designed to be compatible with `OpenAI Thread Objects` with additional properties needed to run on our infrastructure.
- Objects contain a `models` field, to track when the user overrides the assistant's default model parameters.

| Property   | Type                                            | Description                                                                                                                                                                                    | Validation                     |
| ---------- | ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| `object`   | enum: `model`, `assistant`, `thread`, `message` | The Jan Object type                                                                                                                                                                            | Defaults to `thread`           |
| `assistants`   | array                                           | An array of Jan Assistant Objects. Threads can "override" an assistant's parameters. Thread-level model parameters are directly saved in the `thread.models` property! (see Models spec) | Defaults to `assistant.name` |
| `messages` | array                                           | An array of Jan Message Objects. (see Messages spec)                                                                                                                                           | Defaults to `[]`               |
| `metadata` | map                                             | Useful for storing additional information about the object in a structured format.                                                                                                             | Defaults to `{}`               |

### Generic Example

```json
// janroot/threads/jan_1700123404.json
"assistants": ["assistant-123"],
"messages": [
    {...message0}, {...message1}
],
"metadata": {
    "summary": "funny physics joke",
},
```

## Filesystem

- `Jan Thread Objects`'s `json` files always has the naming schema: `assistant_uuid` + `unix_time_thread_created_at. See below.
- Threads are all saved in the `janroot/threads` folder in a flat folder structure.
- The folder is standalone and can be easily zipped, exported, and cleared.

```sh
janroot/
    threads/
        jan_1700123404.json
        homework_helper_700120003.json
```

## Jan API
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
    "id": 'thread_abc123',
    "object": 'thread',
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
    "id": 'thread_abc123',
    "object": 'thread',
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
            "metadata": {},
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
-> Can achieve this goal by calling `Get Thread` API

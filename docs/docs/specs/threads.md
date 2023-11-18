---
title: Threads
---

:::warning

Draft Specification: functionality has not been implemented yet. 

Feedback: [HackMD: Threads Spec](https://hackmd.io/BM_8o_OCQ-iLCYhunn2Aug)

:::

## User Stories

_Users can chat with an assistant in a thread_

- See [Messages Spec]

_Users can change model in a new thread_

- Wireframes here

_Users can change model parameters in a thread_

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
| `models`   | array                                           | An array of Jan Model Objects. Threads can "override" an assistant's model run parameters. Thread-level model parameters are directly saved in the `thread.models` property! (see Models spec) | Defaults to `assistant.models` |
| `messages` | array                                           | An array of Jan Message Objects. (see Messages spec)                                                                                                                                           | Defaults to `[]`               |
| `metadata` | map                                             | Useful for storing additional information about the object in a structured format.                                                                                                             | Defaults to `{}`               |

### Generic Example

```json
// janroot/threads/jan_1700123404.json
"messages": [
    {...message0}, {...message1}
],
"metadata": {
    "summary": "funny physics joke",
},
```

## Filesystem

- `Jan Thread Objects`' `json` files always has the naming schema: `assistant_uuid` + `unix_time_thread_created_at. See below.
- Threads are all saved in the `janroot/threads` folder in a flat folder structure.
- The folder is standalone and can be easily zipped, exported, and cleared.

```sh
janroot/
    threads/
        jan_1700123404.json
        homework_helper_700120003.json
```

## Jan API

### Thread API Object

#### `GET /v1/threads/{thread_id}`

- The `Jan Thread Object` maps into the `OpenAI Thread Object`.
- Properties marked with `*` are compatible with the [OpenAI `thread` object](https://platform.openai.com/docs/api-reference/threads)
- Note: The `Jan Thread Object` has additional properties when retrieved via its API endpoint.
- https://platform.openai.com/docs/api-reference/threads/getThread

| Property       | Type    | Public Description                                                  | Jan Thread Object (`t`) Property |
| -------------- | ------- | ------------------------------------------------------------------- | -------------------------------- |
| `id`\*         | string  | Thread uuid, also the name of the Jan Thread Object file: `id.json` | `json` filename                  |
| `object`\*     | string  | Always "thread"                                                     | `t.object`                       |
| `created_at`\* | integer |                                                                     | `json` file creation time        |
| `metadata`\*   | map     |                                                                     | `t.metadata`                     |
| `models`       | array   |                                                                     | `t.models`                       |
| `messages`     | array   |                                                                     | `t.messages`                     |

### Create Thread

#### `POST /v1/threads`

- https://platform.openai.com/docs/api-reference/threads/createThread

### Retrieve Thread

#### `GET v1/threads/{thread_id}`

- https://platform.openai.com/docs/api-reference/threads/getThread

### Modify Thread

#### `POST v1/threads/{thread_id}`

- https://platform.openai.com/docs/api-reference/threads/modifyThread

### Delete Thread

#### `DELETE v1/threads/{thread_id}`

- https://platform.openai.com/docs/api-reference/threads/deleteThread

### List Threads

> This is a Jan-only endpoint, not supported by OAI yet.

#### `GET v1/threads`

### Get & Modify `Thread.Models`

> This is a Jan-only endpoint, not supported by OAI yet.

#### `GET v1/threads/{thread_id}/models`

#### `POST v1/threads/{thread_id}/models/{model_id}`

- Since users can change model parameters in an existing thread

### List `Thread.Messages`

> This is a Jan-only endpoint, not supported by OAI yet.

#### `GET v1/threads/{thread_id}/messages`

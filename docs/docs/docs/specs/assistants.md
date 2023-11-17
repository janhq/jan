---
title: "Assistants"
---

## User Stories

_Users can chat with an assistant_

- [Wireframes - show asst object properties]
- See [Threads Spec](https://hackmd.io/BM_8o_OCQ-iLCYhunn2Aug)

_Users can use Jan - the default assistant_

- [Wireframes here - show model picker]
- See [Default Jan Object](#Default-Jan-Example)

_Users can create an assistant from scratch_

- [Wireframes here - show create asst flow]
- Users can select any model for an assistant. See [Model Spec]()

_Users can create an assistant from an existing assistant_

- [Wireframes showing asst edit mode]

## Jan Assistant Object

- A `Jan Assistant Object` is a "representation of an assistant"
- Objects are defined by `assistant-uuid.json` files in `json` format
- Objects are designed to be compatible with `OpenAI Assistant Objects` with additional properties needed to run on our infrastructure.
- ALL object properties are optional, i.e. users should be able to use an assistant declared by an empty `json` file.

| Property      | Type                                            | Description                                                                                    | Validation                      |
| ------------- | ----------------------------------------------- | ---------------------------------------------------------------------------------------------- | ------------------------------- |
| `object`      | enum: `model`, `assistant`, `thread`, `message` | The Jan Object type                                                                            | Defaults to `assistant`         |
| `name`        | string                                          | A vanity name.                                                                                 | Defaults to filename            |
| `description` | string                                          | A vanity description.                                                                          | Max `n` chars. Defaults to `""` |
| `models`      | array                                           | A list of Model Objects that the assistant can use.                                            | Defaults to ALL models          |
| `metadata`    | map                                             | This can be useful for storing additional information about the object in a structured format. | Defaults to `{}`                |
| `tools`       | array                                           | TBA.                                                                                           | TBA                             |
| `files`       | array                                           | TBA.                                                                                           | TBA                             |

### Generic Example

```json
// janroot/assistants/example/example.json
"name": "Homework Helper",

// Option 1 (default): all models in janroot/models are available via Model Picker
"models": [],

// Option 2: creator can configure custom parameters on existing models in `janroot/models` &&
// Option 3: creator can package a custom model with the assistant
"models": [{ ...modelObject1 }, { ...modelObject2 }],
```

### Default Jan Example

- Every user install has a default "Jan Assistant" declared below.
  > Q: can we omit most properties in `jan.json`? It's all defaults anyway.

```json
// janroot/assistants/jan/jan.json
"description": "Use Jan to chat with all models",
```

## Filesystem

- Everything needed to represent & run an assistant is packaged into an `Assistant folder`.
- The folder is standalone and can be easily zipped, imported, and exported, e.g. to Github.
- The folder always contains an `Assistant Object`, declared in an `assistant-uuid.json`.
  - The folder and file must share the same name: `assistant-uuid`
- In the future, the folder will contain all of the resources an assistant needs to run, e.g. custom model binaries, pdf files, custom code, etc.

```sh
janroot/
    assistants/
        jan/                       # Assistant Folder
            jan.json               # Assistant Object
        homework-helper/           # Assistant Folder
            homework-helper.json   # Assistant Object
```

### Custom Code

> Not in scope yet. Sharing as a preview only.

- Assistants can call custom code in the future
- Custom code extends beyond `function calling` to any features that can be implemented in `/src`

```sh
example/                       # Assistant Folder
    example.json               # Assistant Object
    package.json
    src/
        index.ts
        helpers.ts
```

### Knowledge Files

> Not in scope yet. Sharing as a preview only

- Assistants can do `retrieval` in future

```sh

example/                       # Assistant Folder
    example.json               # Assistant Object
    files/
```

## Jan API

### Assistant API Object

#### `GET /v1/assistants/{assistant_id}`

- The `Jan Assistant Object` maps into the `OpenAI Assistant Object`.
- Properties marked with `*` are compatible with the [OpenAI `assistant` object](https://platform.openai.com/docs/api-reference/assistants)
- Note: The `Jan Assistant Object` has additional properties when retrieved via its API endpoint.
- https://platform.openai.com/docs/api-reference/assistants/getAssistant

| Property         | Type           | Public Description                                                        | Jan Assistant Object (`a`) Property |
| ---------------- | -------------- | ------------------------------------------------------------------------- | ----------------------------------- |
| `id`\*           | string         | Assistant uuid, also the name of the Jan Assistant Object file: `id.json` | `json` filename                     |
| `object`\*       | string         | Always "assistant"                                                        | `a.object`                          |
| `created_at`\*   | integer        | Timestamp when assistant was created.                                     | `a.json` creation time              |
| `name`\*         | string or null | A display name                                                            | `a.name` or `id`                    |
| `description`\*  | string or null | A description                                                             | `a.description`                     |
| `model`\*        | string         | Text                                                                      | `a.models[0].name`                  |
| `instructions`\* | string or null | Text                                                                      | `a.models[0].parameters.prompt`     |
| `tools`\*        | array          | TBA                                                                       | `a.tools`                           |
| `file_ids`\*     | array          | TBA                                                                       | `a.files`                           |
| `metadata`\*     | map            | TBA                                                                       | `a.metadata`                        |
| `models`         | array          | TBA                                                                       | `a.models`                          |

### Create Assistant

#### `POST /v1/assistants`

- https://platform.openai.com/docs/api-reference/assistants/createAssistant

### Retrieve Assistant

#### `GET v1/assistants/{assistant_id}`

- https://platform.openai.com/docs/api-reference/assistants/getAssistant

### Modify Assistant

#### `POST v1/assistants/{assistant_id}`

- https://platform.openai.com/docs/api-reference/assistants/modifyAssistant

### Delete Assistant

#### `DELETE v1/assistants/{assistant_id}`

- https://platform.openai.com/docs/api-reference/assistants/deleteAssistant

### List Assistants

#### `GET v1/assistants`

- https://platform.openai.com/docs/api-reference/assistants/listAssistants

### CRUD Assistant.Models

- This is a Jan-only endpoint, since Jan supports the ModelPicker, i.e. an `assistant` can be created to run with many `models`.

#### `POST /v1/assistants/{assistant_id}/models`

#### `GET /v1/assistants/{assistant_id}/models`

#### `GET /v1/assistants/{assistant_id}/models/{model_id}`

#### `DELETE /v1/assistants/{assistant_id}/models`

Note: There's no need to implement `Modify Assistant.Models`

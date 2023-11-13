---
title: "Files"
---

Files can be used by `threads`, `assistants` and `fine-tuning`

> Equivalent to: https://platform.openai.com/docs/api-reference/files

## Files Object

- Equivalent to: https://platform.openai.com/docs/api-reference/files
- Note: OAI's struct doesn't seem very well designed
- `files.json`

```json
{
  // Public properties (OpenAI Compatible: https://platform.openai.com/docs/api-reference/files/object)
  "id": "file-BK7bzQj3FfZFXr7DbL6xJwfo",
  "object": "file",
  "bytes": 120000,
  "created_at": 1677610602,
  "filename": "salesOverview.pdf",
  "purpose": "assistants"
}
```

## File API

## Files Filesystem

- Files can exist in several parts of Jan's filesystem
- TODO: are files hard copied into these folders? Or do we define a `files.json` and only record the relative filepath?

```sh=
/files                  # root `/files` for finetuning, etc
/assistants
    /jan
        /files          # assistant-specific files
/threads
    /jan-12938912
        /files          # thread-specific files

```

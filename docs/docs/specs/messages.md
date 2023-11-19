---
title: Messages
---

:::warning

Draft Specification: functionality has not been implemented yet. 

Feedback: [HackMD: Threads Spec](https://hackmd.io/BM_8o_OCQ-iLCYhunn2Aug)

:::

Messages are within `threads` and capture additional metadata.
> OpenAI Equivalent: https://platform.openai.com/docs/api-reference/messages

## Message Object
> OpenAI Equivalent: https://platform.openai.com/docs/api-reference/messages/object
```json
{
  // Jan specific properties
  "updatedAt": "...", // that's it I think

  // OpenAI compatible properties: https://platform.openai.com/docs/api-reference/messages)
  "id": "msg_dKYDWyQvtjDBi3tudL1yWKDa",
  "object": "thread.message",
  "created_at": 1698983503,
  "thread_id": "thread_RGUhOuO9b2nrktrmsQ2uSR6I",
  "role": "assistant",
  "content": [
    {
      "type": "text",
      "text": {
        "value": "Hi! How can I help you today?",
        "annotations": []
      }
    }
  ],
  "file_ids": [],
  "assistant_id": "asst_ToSF7Gb04YMj8AMMm50ZLLtY",
  "run_id": "run_BjylUJgDqYK9bOhy4yjAiMrn",
  "metadata": {}
}
```

## Messages API
> OpenAI Equivalent: https://platform.openai.com/docs/api-reference/messages

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
```
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
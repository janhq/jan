---
title: Messages
---

:::warning

Draft Specification: functionality has not been implemented yet. 

Feedback: [HackMD: Threads Spec](https://hackmd.io/BM_8o_OCQ-iLCYhunn2Aug)

:::

Messages are within `threads` and capture additional metadata.

- Equivalent to: https://platform.openai.com/docs/api-reference/messages

## Message Object

- Equivalent to: https://platform.openai.com/docs/api-reference/messages/object

```json
{
  // Jan specific properties
  "updatedAt": "..." // that's it I think

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

- Equivalent to: https://platform.openai.com/docs/api-reference/messages

```sh
POST https://api.openai.com/v1/threads/{thread_id}/messages # create msg
GET https://api.openai.com/v1/threads/{thread_id}/messages  # list messages
GET https://api.openai.com/v1/threads/{thread_id}/messages/{message_id}

# Get message file
GET https://api.openai.com/v1/threads/{thread_id}/messages/{message_id}/files/{file_id}
# List message files
GET https://api.openai.com/v1/threads/{thread_id}/messages/{message_id}/files
```

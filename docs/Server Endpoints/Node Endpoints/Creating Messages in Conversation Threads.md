
  
  

# **Creating Messages in Conversation Threads**

## About Creating Messages in Jan Threads

The `app.post('/:threadId/messages')` endpoint allows creating a new message in an existing conversation thread in Jan. Messages are persisted to the file system.

## Why Create Messages in Threads

This endpoint enables adding new messages to a conversation between the user and an assistant. Each new message will be appended to the message history for that thread.

## Required Body Params

The body params required are:

- `threadId` - The ID of the thread to add the message to 
- `message` - The message content/payload

## Prerequisites

- A valid assistant and thread ID that exists on disk
- Body content properly serialized to JSON

## Example Request

```
curl --location --request POST 'localhost:1337/xyz123_456/messages' \
--header 'Content-Type: application/json' \
--data-raw '{
    "content": "Hello, how can I help you today?"
}'
```

This would add a new message to the thread with ID `xyz123_456`.


  
  
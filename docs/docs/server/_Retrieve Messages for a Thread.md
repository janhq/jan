
  
  

# **Get Messages for a Thread** 

## About Getting Messages for a Thread

The `app.get('/:threadId/messages')` endpoint allows retrieving all messages for a given thread ID. It is part of the JAN node.js library running on port 1337.

## Why Retrieve Thread Messages

This endpoint is useful for displaying a full thread and its message history in a UI or processing the content of a thread.

## Required Parameters

This endpoint takes one parameter via the URL route:

- `threadId` - The ID of the thread to get messages for

## Prerequisites

- The JAN server must be running on port 1337
- A valid thread ID must be provided

## Example Request

```
curl localhost:1337/123e4567-e89b-12d3-a456-426614174000/messages
```

This will return a JSON array containing all the messages for the thread with ID `123e4567-e89b-12d3-a456-426614174000`.

The `getMessages()` helper function is used to handle reading the messages from the file system and returning them.


  
  
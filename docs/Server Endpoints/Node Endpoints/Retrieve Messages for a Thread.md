
  
  

# **Get Messages for a Thread**

## About Getting Messages for a Thread 

The `app.get('/:threadId/messages')` endpoint allows retrieving all messages for a specific thread ID. It is part of the JAN node.js library that runs on port 1337.

## Why Retrieve Thread Messages

This endpoint would be useful for displaying a thread's history or analyzing message content.

## Required Parameters

This endpoint takes one parameter via the route URL:

- `threadId` - The ID of the thread to get messages for. This maps to the `threadId` parameter in `getMessages()`.

## Prerequisites

- The JAN server must be running on port 1337
- A valid `threadId` must be provided that corresponds to an existing thread

## Example Request

Here is an example cURL request to retrieve messages for thread ID `123_456`:

```
curl http://localhost:1337/123_456/messages
```

The response would contain a JSON array of message objects for the thread.


  
  
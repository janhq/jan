
  
  

# **Retrieving a Message from a Thread**

## About Retrieving Messages from Threads

The `app.get('/:threadId/messages/:messageId')` endpoint allows retrieving a specific message from a thread given the thread ID and message ID.

## Why Retrieve a Single Message

This endpoint is useful when you only need to get a specific message from a thread instead of retrieving all the messages. It's more efficient than getting all messages and filtering on the client side.

## Required Parameters

- `threadId` - The ID of the thread to get the message from 
- `messageId` - The ID of the specific message to retrieve

These parameters are passed in the route URL.

## Prerequisites

- The thread and message IDs must exist in the data store
- User must have access to retrieve messages from the given thread

## Example Request

Here is a sample curl request to retrieve message `123abc` from thread `456def`:

```
curl http://localhost:1337/456def/messages/123abc
```

This will return the message object with ID `123abc` from the thread `456def` if it exists.


  
  
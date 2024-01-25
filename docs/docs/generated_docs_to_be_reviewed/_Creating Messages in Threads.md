
  
  

# **Creating Messages in a Thread**

## About Creating Messages in Threads

The `app.post('/:threadId/messages')` endpoint allows creating a new message in an existing thread in Jan.

## Why should I use this endpoint

This endpoint should be used whenever you want to add a new message to a thread in Jan. It handles creating the message, assigning IDs, saving to the file system, etc.

## What are the path and body params required?

**Path Parameters:**

- `threadId` - The ID of the thread to add the message to

**Body Parameters:**

- `message` - The message content/data to save. Passed to `createMessage` function.

## Prerequisites

- A valid `threadId` for an existing thread
- Body parameter with `message` content 

## Example Curl

```
curl -X POST -H "Content-Type: application/json" 
  -d '{"message": "Hello world"}' 
  http://localhost:1337/abc123/messages
```

This would add a new "Hello world" message to the thread with ID `abc123`.


  
  

  
  

# **Retrieve Message from Thread Endpoint**

## About the JAN Server and API Endpoints

The JAN server provides a Node.js API with endpoints running on port 1337. This endpoint is for retrieving a specific message from a thread.

## Why should I use this API Endpoint  

You should use this endpoint when you want to get the details of a single message in a thread. It allows you to retrieve message data by providing the thread ID and message ID.

## What are the required parameters?

This endpoint requires two parameters in the URL path:

- `threadId` - The ID of the thread the message belongs to 
- `messageId` - The ID of the message to retrieve

These IDs uniquely identify the thread and message.

## Prerequisites

- The JAN server must be running on port 1337
- A valid thread ID and message ID must be provided

## Example Curl

Here is an example curl to retrieve message with ID `abc123` from thread with ID `xyz456`:

```
curl http://localhost:1337/xyz456/messages/abc123 
```

This will return the message data in JSON format if a match is found, otherwise a 404 error.

The `retrieveMessage` function handles the lookup logic by:

1. Getting all messages for the thread ID 
2. Filtering to find the matching message by ID
3. Returning the message object if found, else a "Not found" error

So in summary, this endpoint allows easy retrieval of thread messages by ID.


  
  
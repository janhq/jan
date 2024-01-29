
  
  

# **Create Thread Endpoint**

## About the JAN Server and API Endpoints

The JAN server provides a Node.js API with endpoints running on port 1337. The `app.post('/')` route handles creating new conversation threads.

## Why should I use this API Endpoint

This endpoint allows creating a new thread of conversation between a user and an assistant. It handles generating a thread ID, validating input, writing thread metadata to disk, and returning the created thread object.

## What are the body params required?

The endpoint expects a thread object in the request body with the following properties:

- `assistants` (required) - Array containing assistant objects 
- `id` - Generated thread ID string
- `created` - Timestamp of thread creation
- `updated` - Timestamp of latest thread update

## Prerequisites

- JAN server running on port 1337
- Valid assistant ID to reference in thread assistants
- Filesystem access for writing thread metadata 

## Example Curl

```
curl -X POST \
  http://localhost:1337/ \
  -H 'Content-Type: application/json' \
  -d '{
    "assistants": [
      {
        "assistant_id": "assistant123"  
      }
    ]
 }'
```

This POST request creates a new thread with the given assistant ID that gets saved to the thread metadata storage.


  
  
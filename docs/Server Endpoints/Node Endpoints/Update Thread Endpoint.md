
  
  

# Update Thread Endpoint

## About the JAN Server and API Endpoints

The JAN server provides a REST API with various endpoints to manage threads. This endpoint allows updating an existing thread.

## Why should I use this update thread endpoint?

You can use this endpoint to modify an existing thread by updating any of its properties like the title, assistants, messages etc. It allows making changes to threads without having to delete and recreate them.

## What are the parameters required? 

This endpoint accepts two parameters:

- `threadId` - The unique ID of the thread to update 
- `thread` - A thread object containing the updated properties to modify

## Prerequisites

- A JAN server instance running on port 1337
- Valid thread ID to update 
- Access to make PATCH requests to the endpoint

## Example request

```
curl -X PATCH \
  http://localhost:1337/threads/123 \
  -H 'Content-Type: application/json' \
  -d '{
    "title": "Updated thread title"  
  }'
```

This request updates the title of the thread with ID `123`. Any other thread properties like assistants, messages etc. can also be updated similarly.


  
  
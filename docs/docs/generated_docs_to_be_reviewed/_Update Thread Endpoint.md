
  
  

# Update Thread Endpoint

## About the Update Thread Endpoint

The update thread endpoint allows updating an existing thread's metadata by providing the thread ID and updated thread object in the request body. It is handled by the `updateThread` function.

## Why Use This Endpoint

This endpoint should be used when you want to update any properties of an existing thread, except for the ID which cannot be changed. For example, you may want to update the title, participants, latest message timestamp etc.

## Required Params

- `threadId` - The ID of the thread to update. Passed as a path param.
- `thread` - The thread object containing the updated properties. Passed in the request body.

## Prerequisites

- The thread must already exist with the provided ID.
- The user must be authorized to update this thread.

## Example Request

```
curl \
  -X PATCH \
  -H "Content-Type: application/json" \
  -d '{"title": "Updated thread title"}' \
  http://localhost:1337/threads/123 
```

This would update the title of thread with ID `123`.

The `updateThread` handler function loads the existing thread data, merges the updated properties, writes the updated JSON file to disk, and returns the updated thread object on success.


  
  
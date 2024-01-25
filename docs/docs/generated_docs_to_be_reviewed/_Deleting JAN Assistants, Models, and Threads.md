
  
  

# Deleting JAN Assistants, Models, and Threads

## About Deleting JAN Objects

The `app.delete()` endpoint allows deleting JAN assistants, models, and threads that are stored on the local filesystem in the `jan` folder under the user's home directory.

## Why Use This Endpoint

This endpoint provides a way to programmatically delete JAN objects that you have previously created and stored locally, allowing you to clear out old or unused assistants, models, and threads.

## Required Parameters

- `key` - The type of JAN object to delete. Must be one of `models`, `assistants`, or `threads` 
- `id` - The specific ID of the object to delete

No request body is required.

## Prerequisites

- The JAN object to delete must already exist in the local `jan` folder
- The app must have permissions to access and modify the local `jan` folder

## Example Request

```
curl -X DELETE \
  http://localhost:1337/models/my-model-id
```

This will attempt to delete the model with ID `my-model-id` from the local `models` directory.

The endpoint will return a 404 error if the specified model does not exist.


  
  
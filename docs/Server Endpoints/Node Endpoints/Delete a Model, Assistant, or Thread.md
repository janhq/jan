
  
   # **delete()**

## About the JAN Server and API Endpoints

Jan endpoints are endpoints from the JAN node js libary that run on port 1337.

## Why should I use this API Endpoint
The `delete()` method in `jan` deletes a model, assistant, or thread by its ID.

## What is the query or body params required?

The following query or body parameters are required:

- `key`: The type of object to delete. Can be one of `models`, `assistants`, or `threads`.
- `id`: The ID of the object to delete.

## Prequsites

- The model, assistant, or thread must exist.

## What is an example Curl to this endpoint.

```
curl -X DELETE http://localhost:1337/models/my-model
```

This will delete the model with the ID `my-model`.

## Why and How

The `delete()` method sends a DELETE request to the JAN server at the `/models/:id`, `/assistants/:id`, or `/threads/:id` endpoint, depending on the value of the `key` parameter. The server then deletes the object with the specified ID.

## Additional Information

The `delete()` method returns a Promise that resolves to the deleted object. If the object does not exist, the Promise will reject with an error.
  
  
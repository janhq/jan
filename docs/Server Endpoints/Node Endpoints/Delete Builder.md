
  
   # **deleteBuilder**

## About the JAN Server and API Endpoints

Jan endpoints are endpoints from the JAN node js libary that run on port 1337.

## Why should I use this API Endpoint

The `deleteBuilder` endpoint is used to delete a builder from the JAN server. This can be useful if you have a builder that you no longer need, or if you want to clean up your workspace.

## What is the query or body params required?

The `deleteBuilder` endpoint requires the following query parameters:

* `key`: The key of the builder to delete.

## Prequsites

Before you can use the `deleteBuilder` endpoint, you must first create a builder. You can do this using the `createBuilder` endpoint.

## What is an example Curl to this endpoint.

The following curl command will delete the builder with the key `my-builder`:

```
curl -X DELETE http://localhost:1337/api/builders/my-builder
```

## Why and How

The `deleteBuilder` endpoint sends a DELETE request to the JAN server. The request includes the key of the builder to delete. The server will then delete the builder from the database.

## Conclusion

The `deleteBuilder` endpoint is a useful tool for deleting builders from the JAN server. It can be used to clean up your workspace or to remove builders that you no longer need.
  
  
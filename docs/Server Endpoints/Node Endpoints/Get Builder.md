
  
   # **getBuilder**

## About the JAN Server and API Endpoints

Jan endpoints are endpoints from the JAN node js libary that run on port 1337.
  
## Why should I use this API Endpoint
The `getBuilder` endpoint is used to retrieve a list of models, assistants, or threads from the JAN server. This can be useful for getting a list of all the available models, assistants, or threads, or for getting a list of models, assistants, or threads that meet specific criteria.

## What is the query or body params required?

The `getBuilder` endpoint does not require any query or body parameters.

## Prequsites
  
## What is an example Curl to this endpoint.

```
curl -X GET http://localhost:1337/models
```

This will return a list of all the models that are available on the JAN server.

## Additional Information
The `getBuilder` endpoint can also be used to retrieve a list of assistants or threads. To do this, simply replace the `models` part of the URL with `assistants` or `threads`.

For example, the following curl command would return a list of all the assistants that are available on the JAN server:

```
curl -X GET http://localhost:1337/assistants
```

And the following curl command would return a list of all the threads that are available on the JAN server:

```
curl -X GET http://localhost:1337/threads
```
  
  
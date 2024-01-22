
  
  

# **File Manager API Endpoint**

## About the File Manager API Endpoint

The fileManager.ts file contains an Express app.post handler that handles the `/app/syncFile` route. This endpoint allows synchronizing files from the client.

## Why should I use this API Endpoint

This endpoint allows the client to sync files with the server. It can be used to upload files that need to be processed or stored on the server.

## What are the request body params required?

No request body params are explicitly defined in the handler. The request object is available but not used.

## Prerequisites

- An Express server running on port 1337
- The `/app/syncFile` route defined
- Request and reply objects passed to the handler

## Example curl request

Here is an example curl request to sync a file:

```
curl --request POST \
  --url http://localhost:1337/app/syncFile \
  --header 'content-type: multipart/form-data' \
  --form file=@myfile.txt
```

This POSTs the myfile.txt file to the /app/syncFile endpoint to be synced on the server.


  
  
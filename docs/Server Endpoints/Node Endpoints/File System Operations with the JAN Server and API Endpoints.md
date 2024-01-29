
  
   # **fs.ts**

## About the JAN Server and API Endpoints

Jan endpoints are endpoints from the JAN node js libary that run on port 1337.
  
## Why should I use this API Endpoint
This endpoint is used to perform file system operations such as reading, writing, and deleting files and directories. It provides a convenient way to interact with the file system from within a Node.js application.

## What is the query or body params required?
This endpoint does not require any query or body parameters.

## Prequsites
Before using this endpoint, you must have the necessary permissions to access the files or directories you want to operate on.

## What is an example Curl to this endpoint.
The following curl command shows you how to use the `fs.ts` endpoint to read the contents of a file:

```
curl -X POST http://localhost:1337/fs/read -d '{ "path": "/path/to/file.txt" }'
```

This command will return the contents of the file `/path/to/file.txt` in the response body.

## Endpoint responses
This endpoint returns a JSON object with the following properties:

* `success`: A boolean value indicating whether the operation was successful.
* `data`: The data returned from the operation. This could be the contents of a file, a list of files in a directory, or an error message.
* `error`: An error message if the operation failed.
  
  
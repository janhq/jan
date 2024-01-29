
  
  

# **File System Routes in JAN**

## About the JAN Server and API Endpoints

The JAN server provides API endpoints running on port 1337 to allow access to Node.js filesystem functions from the renderer process in an Electron app.

## Why use the File System Routes

The file system routes enable executing filesystem operations like reading files, deleting folders etc. from the renderer process by proxying requests to the main process. This avoids issues with the renderer not having access to native modules like `fs`.

## Query and Body Params

The body params need to contain a JSON string with the following:

- `route` - The name of the Node fs module function to execute e.g. `readdirSync` 
- Array of `args` - The arguments to pass to the fs function
  
Any string arguments that start with `file:/` will be converted to an absolute filesystem path joining the `userSpacePath` directory.

## Prerequisites

- The JAN server needs to be running on port 1337
- The `userSpacePath` variable must be initialized to the appropriate user directory.

## Example cURL

Here is an example cURL to proxy the `readdirSync` method:

```
curl --location --request POST 'localhost:1337/fs' \
--header 'Content-Type: application/json' \
--data-raw '{
    "route": "readdirSync",
    "args": [
        "file:/documents"
    ]
}'
```

This would list all files and folders in `/Users/<user>/documents` by joining `userSpacePath` with the `file:/documents` argument.


  
  
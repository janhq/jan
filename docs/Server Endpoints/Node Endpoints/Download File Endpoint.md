
  
  

# **Download File Endpoint**

## About the Download Endpoint

The `/downloadFile` endpoint allows downloading a file from a URL to the local file system. It is part of the JAN node.js library running on port 1337.

## Why Use This Endpoint

This endpoint provides the ability to download a file in a streamable way, showing progress and handling errors. It pipes the file request to disk instead of buffering the entire file contents in memory.

## Endpoint Params

The endpoint expects a JSON body with an array containing the URL to download from and the local file path to save to.

For example:

```
["http://example.com/file.zip", "/path/to/destination.zip"] 
```

Any local file path prefixed with `file:/` will be converted to an absolute path on the user's file system.

## Prerequisites

The `request` and `request-progress` node modules need to be installed to enable the streaming and progress tracking.

## Example Curl

```
curl -X POST -H "Content-Type: application/json" -d '["http://example.com/file.zip", "file:/Downloads/folder/destination.zip"]' http://localhost:1337/downloadFile
```

This will download the file from the URL to the user's Downloads/folder directory on their local machine.

Progress and errors will be logged to the console. The file request is also stored for future reference keyed by file name.


  
  
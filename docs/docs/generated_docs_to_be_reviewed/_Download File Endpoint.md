
  
  

# **Download File Endpoint**

## About the Download Endpoint

The `/downloadFile` endpoint allows downloading a file from a URL to the local file system. It is part of the JAN node.js library that runs on port 1337.

## Why Use This Endpoint

This endpoint provides the ability to download a file in a Node.js application and save it locally, while handling events and progress for the download.

## Endpoint Params

The `/downloadFile` endpoint expects a POST request with a JSON body containing an array with two elements:

1. The URL of the file to download 
2. The local file path to save the downloaded file to

It will also normalize any `file:/` paths to the proper local path.

## Prerequisites

- JAN node.js server running on port 1337
- Valid URL that can be downloaded from
- Local file path with write access  

## Example Request

```
curl --location --request POST 'http://localhost:1337/downloadFile' \
--header 'Content-Type: application/json' \
--data-raw '[ 
  "http://example.com/file.zip",
  "file:/users/documents/file.zip"
]'
```

This will download the file from `http://example.com/file.zip` and save it to `/users/documents/file.zip`, registering event listeners for progress and errors.

The key things this endpoint provides are:

- Downloading a file from a URL 
- Saving to a local file path
- Normalizing `file:/` paths
- Handling download events and progress


  
  
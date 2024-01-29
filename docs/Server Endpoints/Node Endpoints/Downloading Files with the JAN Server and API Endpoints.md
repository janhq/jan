
  
   # **downloadFile**

## About the JAN Server and API Endpoints

Jan endpoints are endpoints from the JAN node js libary that run on port 1337.
  
## Why should I use this API Endpoint
The `downloadFile` endpoint is used to download a file from a specified URL and save it to a specified local path. This endpoint is useful for downloading files from remote servers or URLs.

## What is the query or body params required?
The following query or body parameters are required to use the `downloadFile` endpoint:

* `url`: The URL of the file to be downloaded.
* `localPath`: The local path where the file should be saved.

## Prequsites
Before using the `downloadFile` endpoint, you must have the following prerequisites:

* The `request` and `progress` modules must be installed.
* The `userSpacePath` variable must be set to the path of the user's home directory.

## What is an example Curl to this endpoint
The following is an example curl command that can be used to download a file from a remote server using the `downloadFile` endpoint:

```
curl -X POST http://localhost:1337/downloadFile -d '{"url": "https://example.com/file.zip", "localPath": "/Users/username/Downloads/file.zip"}'
```

## Explanation
The above curl command will send a POST request to the `downloadFile` endpoint with the following JSON body:

```
{
  "url": "https://example.com/file.zip",
  "localPath": "/Users/username/Downloads/file.zip"
}
```

The `url` parameter specifies the URL of the file to be downloaded, and the `localPath` parameter specifies the local path where the file should be saved.

The `downloadFile` endpoint will then download the file from the specified URL and save it to the specified local path.

## Why and How
The `downloadFile` endpoint is a convenient way to download files from remote servers or URLs. It can be used to download files for a variety of purposes, such as:

* Downloading files for offline use.
* Downloading files for use in other applications.
* Downloading files for backup purposes.

The `downloadFile` endpoint is easy to use and can be used with a variety of programming languages and tools.
  
  
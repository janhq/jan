
  
   # **syncFile**

## About the JAN Server and API Endpoints

Jan endpoints are endpoints from the JAN node js libary that run on port 1337.
  
## Why should I use this API Endpoint
The `syncFile` endpoint is used to synchronize a file between the client and the server. This can be useful for keeping files up-to-date between multiple devices, or for backing up files to a remote location.

## What is the query or body params required?

The `syncFile` endpoint requires the following query parameters:

* `file`: The name of the file to be synchronized.
* `content`: The contents of the file to be synchronized.

## Prequsites

Before using the `syncFile` endpoint, you must first create a JAN account and obtain an API key. You can do this by visiting the JAN website and signing up for a free account.

Once you have an API key, you can use it to authenticate with the JAN API. To do this, simply include the `Authorization` header in your request, with the value set to `Bearer {{API_KEY}}`.

## What is an example Curl to this endpoint.

The following is an example curl command that can be used to synchronize a file with the JAN API:

```
curl -X POST "https://jan.io/api/syncFile" \
  -H "Authorization: Bearer {{API_KEY}}" \
  -F "file=myfile.txt" \
  -F "content=Hello, world!"
```

This command will synchronize the file `myfile.txt` with the JAN API. The contents of the file will be set to `Hello, world!`.

## Conclusion

The `syncFile` endpoint is a powerful tool that can be used to synchronize files between multiple devices or to back up files to a remote location. It is easy to use and requires only a few simple steps to get started.
  
  
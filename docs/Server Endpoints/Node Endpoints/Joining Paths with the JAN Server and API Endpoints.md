
  
   # **joinPath**

## About the JAN Server and API Endpoints

Jan endpoints are endpoints from the JAN node js libary that run on port 1337.
  
## Why should I use this API Endpoint

The joinPath endpoint is used to join multiple paths together. This can be useful for creating file paths, URLs, or any other type of path.

## What is the query or body params required?

The joinPath endpoint takes a single parameter, which is an array of strings. Each string in the array represents a path segment.

## Prequsites
  
## What is an example Curl to this endpoint.

```
curl -X POST http://localhost:1337/joinPath -d '["/path/to/file1", "/path/to/file2"]'
```

This curl command will join the two paths together and return the result. In this case, the result would be "/path/to/file1/path/to/file2".

## Explanation

The joinPath endpoint uses the `path.join()` method to join the paths together. The `path.join()` method takes an array of strings as its first argument and returns a single string that represents the joined path.

The `path.join()` method works by iterating over the array of strings and joining them together with the appropriate separator. The separator is determined by the operating system. On Windows, the separator is the backslash (\), while on Unix-based systems, the separator is the forward slash (/).

The joinPath endpoint can be used to join together any number of paths. However, it is important to note that the paths must be valid. If any of the paths are invalid, the joinPath endpoint will return an error.

## Conclusion

The joinPath endpoint is a useful tool for joining multiple paths together. It can be used for creating file paths, URLs, or any other type of path.
  
  
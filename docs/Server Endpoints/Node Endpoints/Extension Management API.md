
  
  

# **Extension Management API**

## About the Extension Management API

The extension management API allows managing extensions in the JAN platform. It provides endpoints for getting active extensions, installing new extensions, removing extensions, etc.

## Why should I use the Extension Management API

You should use the extension management API if you want to programatically manage the extensions used in JAN. For example, you may want to install a new extension from an npm package or enable/disable existing extensions.

## What are the endpoints and parameters

Here are some key endpoints and their parameters:

- `GET /extensions/active` - Gets a list of currently active extensions
  - No parameters
- `POST /extensions` - Installs a new extension 
  - Body parameter:
    - `package` - npm package name of the extension
- `DELETE /extensions/{name}` - Removes an extension
  - Path parameter:
    - `name` - name of the extension package to remove

## Prerequisites

- The JAN server must be running
- To call endpoints, a REST client or a programming language with HTTP capabilities is needed 

## Example request

Here is an example curl request to get active extensions:

```
curl \
  -X GET \
  http://localhost:1337/extensions/active
```

It will return a JSON array of active extension objects.


  
  
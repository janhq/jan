
  
  

# **Extension Management in Jan**

## About Extension Management in Jan

The Jan server provides functionality to manage extensions through a set of API endpoints that run on port 1337. These endpoints allow installing, removing, and interacting with extensions.

## Why Use the Extension Management API

The extension management API provides a convenient way to install and manage extensions for the Jan platform from within a Jan application. It handles tasks like registering extension protocols, persisting extension state, and activating/deactivating extensions.

## Required Query/Body Parameters

Some key parameters when working with the extension management API:

- `origin` - The npm package specifier for the extension 
- `version` - Optional version to install
- `options` - Other options like where to install the extension
- `name` - The name of the extension to retrieve or remove 
- `extensionsPath` - Path to install extensions to
- `active` - Whether to activate or deactivate an extension

## Prerequisites

- The `extensions` module needs to be initialized with `useExtensions()` before installing/managing extensions
- Path where extensions will be installed must be set via `extensionsPath` option

## Example Usage

Here is an example of installing and activating a new extension:

```
curl -X POST \
  http://localhost:1337/extensions \
  -H 'Content-Type: application/json' \
  -d '{
    "origin": "my-extension",
    "version": "1.2.3",
    "activate": true  
  }'
```

This will install version 1.2.3 of the "my-extension" package from npm, store it in the extensions path, and activate it within Jan.


  
  
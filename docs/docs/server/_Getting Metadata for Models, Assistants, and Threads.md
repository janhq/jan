
  
  

# **Getting Model, Assistant, and Thread Metadata** 

## About the JAN Server and API Endpoints

The JAN server runs on port 1337 and exposes API endpoints to retrieve metadata about models, assistants, and threads stored on the local filesystem.

## Why should I use this API Endpoint

This `/models`, `/assistants`, and `/threads` endpoint allows retrieving metadata about all models, assistants, and threads stored in the respective folders on disk. This is useful for listing available resources that can be used with other JAN APIs.

## What are the query or body params required?

No request body or query parameters are required.

## Prerequisites

- JAN server running on port 1337
- Models, assistants, or threads saved to disk in the expected folder structure

## What is an example Curl to this endpoint?

```
curl http://localhost:1337/models
```

This performs a GET request to retrieve metadata about all models stored on disk. The response would be a JSON array of model metadata objects.

The same pattern applies for `/assistants` and `/threads`.


  
  

  
  

# Download Model Endpoint

## About Models in JAN

Models in JAN are AI models that can be downloaded and run locally. The models are accessed through the JAN API endpoints running on port 1337.

## Why Use the Download Model Endpoint

The `/models/download/:modelId` endpoint allows you to download a specific model to use locally by providing the model ID. 

## Endpoint Params

The endpoint takes one parameter which is the `:modelId` representing the specific model to download. This must match a valid model ID that exists in JAN.

## Prerequisites

- JAN server running on port 1337
- Valid model ID to pass to the endpoint

## Example Usage

Here is an example cURL to download a model with ID `my-model`:

```
curl -X GET "http://localhost:1337/models/download/my-model"
```

This will trigger the `downloadModel` helper method which will:

- Retrieve model metadata from JAN storage
- Create a directory for the model 
- Download model binary data into directory
- Return response when download starts

The helper method utilizes utils like `fs`, `path`, and `request` to coordinate the download. It also leverages other JAN utilities to lookup model data before downloading.


  
  
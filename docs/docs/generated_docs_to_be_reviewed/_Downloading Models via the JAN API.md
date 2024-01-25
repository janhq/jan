
  
  

# Downloading Models via the JAN API

## About Model Downloads in JAN

The JAN API exposes an endpoint for downloading trained models at `/models/download/:modelId`. This allows fetching a model binary that has been trained and uploaded to the JAN server.

## Why Download Models via the API?

Downloading models through the API is useful for:

- Retrieving a model to use for inference/predictions locally
- Inspecting and analyzing a model that was trained in JAN
- Transferring models from a JAN server to another system

## API Request Parameters

The `/models/download/:modelId` endpoint accepts a single parameter via the URL route:

- `modelId` - The ID of the model to download (required) 

The model ID maps to a model that has been previously trained and uploaded to the JAN server.

## Prerequisites

- A JAN server running with trained models uploaded and stored 
- The model ID for the desired model
- Access and ability to make requests to the JAN API

## Example Request

Here is an example `curl` request to download a model with ID `my-model`:

```
curl http://localhost:1337/models/download/my-model 
```

This will initiate the download process and save the model binary to the `models/my-model` directory locally.

The API uses Node.js streams for efficient file downloads. The code handles all aspects of storage and downloads behind the scenes based on the provided model ID.


  
  
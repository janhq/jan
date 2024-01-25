
  
  

# **chatCompletions API Endpoint**

## About the chatCompletions Endpoint 

The chatCompletions endpoint is part of the JAN node.js library that runs on port 1337. It handles chat completions using AI models.

## Why Use This Endpoint

This endpoint allows you to get AI-generated chat completions from various models that are configured on the JAN server. It handles querying the correct model, authorizing with API keys, and streaming back the completion text.

## Required Body Params

The chatCompletions endpoint requires a JSON body with the following:

- `model` - The ID of the model to use for completion 

## Prerequisites

- Models need to be configured on the JAN server under the `models` directory
- Engine configuration for models needs to be set up under the `engines` directory
- API keys need to be configured for external models 

## Example Request

Here is an example cURL request to get a chat completion:

```
curl -X POST -H "Content-Type: application/json" -d '{"model":"my-model", "prompt":"Hello my name is"} http://localhost:1337/chat/completions
```

This will post a request to the endpoint to generate a completion for the prompt "Hello my name is" using the model "my-model".

The code handles looking up the correct model, getting its engine configuration and API key if an external model, and streams back the completion text from the model.


  
  
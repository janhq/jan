
  
  

# **Create Thread Endpoint**

## About the JAN Server and API Endpoints

The JAN server provides various endpoints for creating and managing threads between assistants and users. The `/` endpoint handled by `app.post` is used to create a new thread.

## Why should I use this API Endpoint  

This endpoint should be used when you want to initiate a new conversation thread between a user and one or more assistants. It handles creating the thread metadata, generating a thread ID, and saving the thread data.

## What is the query or body params required?

This endpoint requires a thread object to be passed in the request body. At a minimum this needs to contain an `assistants` array with at least one assistant object containing an `assistant_id` field. Other optional fields like `title`, `users`, etc can be added.

Example body:

```
{
  "assistants": [
    {
      "assistant_id": "my_assistant" 
    }
  ],
  "title": "My Thread"
}
```

## Prequsites

The JAN server needs to be running on port 1337 for this endpoint to work. The path where threads are saved also needs to exist.

## What is an example Curl to this endpoint 

```
curl --location --request POST 'http://localhost:1337/' \
--header 'Content-Type: application/json' \
--data-raw '{
    "assistants": [
      {
        "assistant_id": "my_assistant"
      }
    ],
    "title": "My new thread"
}'
```

This will create a new thread with the given assistant and return the thread object including a generated ID.


  
  
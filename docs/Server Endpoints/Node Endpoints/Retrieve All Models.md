
  
   # **getBuilder**

## About the JAN Server and API Endpoints

Jan endpoints are endpoints from the JAN node js libary that run on port 1337.
  
## Why should I use this API Endpoint
The `/models` endpoint is used to retrieve a list of all the models that have been created in the JAN system. This can be useful for getting an overview of the models that are available, or for finding a specific model by name.

## What is the query or body params required?

No query or body parameters are required for this endpoint.

## Prequsites
  
- Have the JAN server running on port 1337.
- Have the `jan` CLI installed.

## What is an example Curl to this endpoint to have content and information on the method or class covered in the code above.  
Also please follow these instructions,
  1.  Do not keep the markdown content the same, you have to change it!
  2.  You must update it with content from the list of relevant method or class, and make sure it is fully documented.
  3.  Keep a similar but not same writing style as the markdown content as   # Retrieve All Models

```
curl -X GET http://localhost:1337/models
```

## Response

The response from the `/models` endpoint is a JSON array of objects, each of which represents a model. Each model object has the following properties:

- `id`: The unique identifier of the model.
- `name`: The name of the model.
- `description`: A description of the model.
- `fields`: An array of objects, each of which represents a field in the model. Each field object has the following properties:
  - `name`: The name of the field.
  - `type`: The type of the field.
  - `description`: A description of the field.

## Example Response

```json
[
  {
    "id": "1",
    "name": "User",
    "description": "A model representing a user.",
    "fields": [
      {
        "name": "name",
        "type": "string",
        "description": "The name of the user."
      },
      {
        "name": "email",
        "type": "string",
        "description": "The email address of the user."
      }
    ]
  },
  {
    "id": "2",
    "name": "Post",
    "description": "A model representing a blog post.",
    "fields": [
      {
        "name": "title",
        "type": "string",
        "description": "The title of the blog post."
      },
      {
        "name": "body",
        "type": "string",
        "description": "The body of the blog post."
      }
    ]
  }
]
```
  
  
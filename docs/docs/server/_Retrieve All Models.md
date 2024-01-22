
  
   # **getModels**

## About the JAN Server and API Endpoints

Jan endpoints are endpoints from the JAN node js libary that run on port 1337.
  
## Why should I use this API Endpoint
This endpoint allows you to retrieve all the models that are available in your Jan instance. This can be useful for getting a list of all the models that you can use in your application, or for getting information about a specific model.

## Prequsites
- You must have a Jan instance running on port 1337.
- You must have the `jan-client` library installed.

## What is an example Curl to this endpoint
```
curl -X GET http://localhost:1337/models
```

## Example Response
```
[
  {
    "id": "model-1",
    "name": "My Model",
    "description": "This is my model.",
    "fields": [
      {
        "name": "name",
        "type": "string"
      },
      {
        "name": "age",
        "type": "number"
      }
    ]
  }
]
```

## Why and How
The above curl command will send a GET request to the `/models` endpoint on your Jan instance. This will return a list of all the models that are available in your Jan instance.

The response from the endpoint will be a JSON array of objects. Each object in the array will represent a model. The object will contain the following properties:

- `id`: The unique identifier of the model.
- `name`: The name of the model.
- `description`: A description of the model.
- `fields`: An array of objects representing the fields in the model. Each object in the array will contain the following properties:
  - `name`: The name of the field.
  - `type`: The type of the field.

## Conclusion
The `getModels` endpoint can be a useful tool for getting information about the models that are available in your Jan instance. This information can be used to build applications that interact with your Jan instance.
  
  
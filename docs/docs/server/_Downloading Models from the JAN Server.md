
  
   # **downloadModel**

## About the JAN Server and API Endpoints

Jan endpoints are endpoints from the JAN node js library that run on port 1337.

## Why should I use this API Endpoint

The `/models/download/:modelId` endpoint allows you to download a model from the JAN server. This can be useful if you want to use a model in a different application or if you want to back up your models.

## What is the query or body params required?

The following query or body params are required:

* `modelId`: The ID of the model you want to download.

## Prequsites

Before you can use the `/models/download/:modelId` endpoint, you must have a JAN server running on port 1337. You can start a JAN server by running the following command:

```
jan serve
```

## What is an example Curl to this endpoint.

The following curl command will download the model with the ID `my-model` from the JAN server:

```
curl -X GET "http://localhost:1337/models/download/my-model" -o my-model.zip
```

## Why and How

The `downloadModel` function is an asynchronous function that takes a model ID as an argument and returns a Promise that resolves to a model object. The model object contains the following properties:

* `id`: The ID of the model.
* `name`: The name of the model.
* `description`: The description of the model.
* `source_url`: The URL of the model source code.
* `binary_path`: The path to the model binary file.

The `downloadModel` function first retrieves the model object from the database. If the model does not exist, the function returns a 404 error.

If the model exists, the function checks if the model binary file exists. If the model binary file does not exist, the function downloads the model binary file from the source URL.

Once the model binary file has been downloaded, the function returns the model object.

## Conclusion

The `/models/download/:modelId` endpoint is a useful tool for downloading models from the JAN server. This endpoint can be used to back up models or to use models in different applications.
  
  
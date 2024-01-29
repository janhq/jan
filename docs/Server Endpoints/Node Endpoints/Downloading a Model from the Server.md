
  
   ## **`downloadModel`**

## About the `downloadModel` method in `jan/core/src/node/api/routes/common.ts`

The `downloadModel` method in `jan/core/src/node/api/routes/common.ts` is used to download a model from the server.

## Why should I use this API Endpoint?

The `downloadModel` method can be used to download a model from the server for use in your own application. This can be useful if you want to use a pre-trained model for a specific task, or if you want to experiment with different models.

## What is the query or body params required?

The `downloadModel` method requires the following query parameters:

* `modelId`: The ID of the model to download.

## Prequsites

Before you can use the `downloadModel` method, you must first install the `jan` package. You can do this by running the following command:

```
npm install jan
```

## What is an example Curl to this endpoint?

The following curl command can be used to download the model with the ID `my-model` from the server:

```
curl -X GET "http://localhost:1337/models/download/my-model"
```

The response from the server will be a zip file containing the model files.

## Conclusion

The `downloadModel` method can be used to download a model from the server for use in your own application. This can be useful if you want to use a pre-trained model for a specific task, or if you want to experiment with different models.
  
  
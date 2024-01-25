
  
   # **retrieveMesasge**

## About the JAN Server and API Endpoints

Jan endpoints are endpoints from the JAN node js libary that run on port 1337.
  
## Why should I use this API Endpoint

This endpoint is used to retrieve a specific message from a thread. It is useful for getting the content of a message, such as the text, attachments, or metadata.

## Prequsites

Before using this endpoint, you must have a valid JAN API key. You can get an API key by creating a JAN account and following the instructions in the [JAN documentation](https://jan.ai/docs/getting-started/api-key).

## What is an example Curl to this endpoint.

```
curl -X GET \
  https://jan.ai/api/threads/{{threadId}}/messages/{{messageId}} \
  -H 'Authorization: Bearer {{API_KEY}}'
```

## Response

The response to this endpoint is a JSON object with the following structure:

```
{
  "message": {
    "id": "{{message_id}}",
    "threadId": "{{thread_id}}",
    "senderId": "{{sender_id}}",
    "content": "{{message_content}}",
    "attachments": [
      {
        "id": "{{attachment_id}}",
        "name": "{{attachment_name}}",
        "type": "{{attachment_type}}",
        "size": "{{attachment_size}}",
        "url": "{{attachment_url}}"
      }
    ],
    "metadata": {
      "{{metadata_key}}": "{{metadata_value}}"
    },
    "createdAt": "{{created_at}}",
    "updatedAt": "{{updated_at}}"
  }
}
```

## Why and How

The `retrieveMesasge` endpoint is useful for getting the content of a specific message from a thread. This can be useful for displaying the message to a user, or for processing the message in some way.

To use the `retrieveMesasge` endpoint, you must first make a GET request to the following URL:

```
https://jan.ai/api/threads/{{threadId}}/messages/{{messageId}}
```

You must replace the `{{threadId}}` and `{{messageId}}` placeholders with the actual thread ID and message ID. You can get the thread ID and message ID from the `threadId` and `messageId` properties of the `message` object that is returned by the `listMessages` endpoint.

In the request header, you must include the `Authorization` header with your JAN API key.

The response to the `retrieveMesasge` endpoint is a JSON object with the following structure:

```
{
  "message": {
    "id": "{{message_id}}",
    "threadId": "{{thread_id}}",
    "senderId": "{{sender_id}}",
    "content": "{{message_content}}",
    "attachments": [
      {
        "id": "{{attachment_id}}",
        "name": "{{attachment_name}}",
        "type": "{{attachment_type}}",
        "size": "{{attachment_size}}",
        "url": "{{attachment_url}}"
      }
    ],
    "metadata": {
      "{{metadata_key}}": "{{metadata_value}}"
    },
    "createdAt": "{{created_at}}",
    "updatedAt": "{{updated_at}}"
  }
}
```

The `message` object contains the following properties:

* `id`: The unique ID of the message.
* `threadId`: The ID of the thread that the message belongs to.
* `senderId`: The ID of the user who sent the message.
* `content`: The content of the message.
* `attachments`: An array of attachments that are included with the message.
* `metadata`: A JSON object containing metadata about the message.
* `createdAt`: The date and time when the message was created.
* `updatedAt`: The date and time when the message was last updated.

The `attachments` array contains objects with the following properties:

* `id`: The unique ID of the attachment.
* `name`: The name of the attachment.
* `type`: The MIME type of the attachment.
* `size`: The size of the attachment in bytes.
* `url`: The URL of the attachment.

The `metadata` object can contain any arbitrary data that you want to associate with the message.

The `createdAt` and `updatedAt` properties are both timestamps in milliseconds since the Unix epoch.
  
  
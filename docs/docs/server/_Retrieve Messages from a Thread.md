
  
   # **getMessages**

## About the JAN Server and API Endpoints

Jan endpoints are endpoints from the JAN node js libary that run on port 1337.
  
## Why should I use this API Endpoint
The `/messages` endpoint is used to retrieve a list of messages for a specific thread. This can be useful for building a chat interface or for retrieving historical messages.

## Prequsites
Before using the `/messages` endpoint, you will need to have a valid JAN API key. You can obtain an API key by creating a JAN account and then visiting the API Keys page.

## What is an example Curl to this endpoint
```
curl -X GET "http://localhost:1337/threads/{{threadId}}/messages" \
  -H "Authorization: Bearer {{apiKey}}"
```

## Response
The `/messages` endpoint returns a JSON object with the following structure:

```
{
  "messages": [
    {
      "id": "{{messageId}}",
      "threadId": "{{threadId}}",
      "senderId": "{{senderId}}",
      "body": "{{messageBody}}",
      "timestamp": "{{timestamp}}"
    }
  ]
}
```

## Why and How
The `GET /threads/:threadId/messages` endpoint is used to retrieve a list of messages for a specific thread. The thread ID is specified in the URL path, and the API key is provided in the Authorization header. The response is a JSON object containing an array of message objects. Each message object has the following properties:

* `id`: The unique ID of the message.
* `threadId`: The ID of the thread that the message belongs to.
* `senderId`: The ID of the user who sent the message.
* `body`: The text of the message.
* `timestamp`: The timestamp of the message.

## Additional Notes
The `/messages` endpoint can be used to retrieve messages from any thread that you have access to. You can also use the `?since=` and `?until=` query parameters to filter the messages by timestamp.

For example, the following curl command would retrieve all messages from the thread with ID `12345` that were sent after January 1, 2023:

```
curl -X GET "http://localhost:1337/threads/12345/messages?since=2023-01-01" \
  -H "Authorization: Bearer {{apiKey}}"
```
  
  
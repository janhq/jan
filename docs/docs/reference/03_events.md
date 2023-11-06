---
title: "events"
---

:::warning
There will be substantial updates to this feature shortly that will disrupt its current functionality or compatibility.
:::

`events` lets you receive events about actions that take place in the app, like when a user sends a new message.

You can then implement custom logic handlers for such events.

## Usage

```js
import { events } from "@janhq/core";
```

You can subscribe to NewMessageRequest events by defining a function to handle the event and registering it with the events object:

```js
import { events } from "@janhq/core";

function handleMessageRequest(message: NewMessageRequest) {
  // Your logic here. For example:
  // const response = openai.createChatCompletion({...})
}
function registerListener() {
  events.on(EventName.OnNewMessageRequest, handleMessageRequest);
}
// Register the listener function with the relevant extension points.
export function init({ register }) {
  registerListener();
}
```

In this example, we're defining a function called handleMessageRequest that takes a NewMessageRequest object as its argument. We're also defining a function called registerListener that registers the handleMessageRequest function as a listener for NewMessageRequest events using the on method of the events object.

```js
import { events } from "@janhq/core";

function handleMessageRequest(data: NewMessageRequest) {
  // Your logic here. For example:
   const response = openai.createChatCompletion({...})
   const message: NewMessageResponse = {
    ...data,
    message: response.data.choices[0].message.content
   }
  // Now emit event so the app can display in the conversation
   events.emit(EventName.OnNewMessageResponse, message)
}
```

## EventName

The `EventName` enum bundles the following events:

- `OnNewConversation`
- `OnNewMessageRequest`
- `OnNewMessageResponse`
- `OnMessageResponseUpdate`
- `OnDownloadUpdate`
- `OnDownloadSuccess`
- `OnDownloadError`

## event.on

Adds an observer for an event.

```js
const on: (eventName: string, handler: Function) => void = (eventName, handler);
```

## event.emit

Emits an event.

```js
const emit: (eventName: string, object: any) => void = (eventName, object);
```

## event.off

Removes an observer for an event.

```js
const off: (eventName: string, handler: Function) => void =
  (eventName, handler);
```

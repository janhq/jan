---
title: "events"
---

`events` lets you receive events about actions that take place in the app, like when a user sends a new message.

You can then implement custom logic handlers for such events.

## Usage

```js
import { events } from "@janhq/core";
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

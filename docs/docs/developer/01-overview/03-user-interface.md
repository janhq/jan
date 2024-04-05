---
title: User Interface
slug: /developer/ui
description: Jan is a ChatGPT-alternative that runs on your own computer, with a local API server.
keywords:
  [
    Jan AI,
    Jan,
    ChatGPT alternative,
    local AI,
    private AI,
    conversational AI,
    no-subscription fee,
    large language model,
  ]
---

:::warning

This page is still under construction, and should be read as a scratchpad

:::

Jan provides a UI Kit for customize the UI for your use case. This means you can personalize the entire application according to your own brand and visual styles.

This page gives you an overview of how to customize the UI.

You can see some of the user interface components when you first open Jan.

To Link:

- Ribbon
- LeftSidebar
- Main
- RightSidebar
- StatusBar

## Views

![Jan Views](/img/jan-views.png)
TODO: add a better image.

### Ribbon

Assistants shortcuts and Modules settings show up here.

```js
import .. from "@jan"
sample code here
```

### LeftSidebar

Conversation threads show up here. This is customizable, so custom assistants can add additional menu items here.

```js
import .. from "@jan"
sample code here
```

### Main

The main view for interacting with assistants. This is customizable, so custom assistants can add in additional UI components. By default, this is a chat thread with assistants.

```js
import .. from "@jan"
sample code here
```

### RightSidebar

A "settings" view for each thread. Users should be able to edit settings or other configs to customize the assistant experience within each thread.

```js
import .. from "@jan"
sample code here
```

### StatusBar

A global status bar that shows processes, hardware/disk utilization and more.

```js
import .. from "@jan"
sample code here
```

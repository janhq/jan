# ADR 009: Platform-SDK

## Changelog

- 2023-10-31: Initial draft

## Authors

- @dan-jan

## Status

What is the status, such as proposed, accepted, rejected, deprecated, superseded, etc.?

{Proposed|Accepted|Rejected}

## Context

What is the issue that we're seeing that is motivating this decision or change?


## Core SDK

- We will have a SDK that supports
    - App SDK (the main, externally marketted SDK)
    - Plugin SDK (at the moment, used internally)
    - Theme SDK

```sh=
.jan
    /models         # .bin files
    /plugins        # system-wide plugins, e.g. monitoring
    /themes         # .css, etc
    /conversations  # Markdown-based convos
    /apps           # generic
        /jan        # default app (allows switching of models)
        /luffy
```
### SDK design principles
- Users shouldn't be bomboarded with many packages, see https://www.npmjs.com/org/janhq.
- Don't even show the core plugins in settings, users shouldnt turn off "inference" for example.
- Users should be able to "onboard" to our SDK in under 5 minutes.

### Core SDK changes:
- Users shouldn't have to register functions. Remove `CoreServices`, expose the functions directly instead via event hooks, or dont let users use it in the sdk
- remove `invokePluginFunc`, users shouldn’t worry about it.
- remove `index` vs `module` file design. Users should just work with a `index.js`.
- abstract away `store`, `CoreService` to lower level, not SDK level
- `Conversations`, `Models` are modular and 1st class primitives
- Users shouldn't have to "register" function

## SDK Proposal
- A single jan package: `import * as jan from ...`

### `this` (App context & lifecycle mgmt)

Objs and helpers around the app's lifecycle

- `constructor`: gives users `this` app's context
- onDownloaded
- onDelete

### Conversations
`Conversation` lib with event hooks and helper methods
- `Conversations::Events`
    - onStartConversation
    - onDeleteConversation
    - onMessageSent
    - onMessageReceived
    - [ ] Q: Event scope - send all apps' events or only the current app's?
- `Conversations::Functions`
    - getConversation (id is just name of the conversation md file?)
        - convo.send
    - getConversationMetadata
    - getMessage

### Models

**`Models` lib with event hooks and helper methods**

- `Model::Events`
    - onModelLoaded
    - onModelDownloaded
    - onModelStartedDownload
    - onModelStarted? // let app builder check compat?
    - onModelStopped?
- `Model::Functions`
    - [ ] How to invoke inferencing?
    - this.model.api() // models can have different APIs!
    - this.model.generate() ? // run before calling Nitro
    - this.model.embeddings()?
    - this.model.metadata

### System

- `System::Events`
    - onFileDownloaded
- `System::Functions`
    - downloadFile
    - deleteFile

### UI Kit

> Dan's comment: We should refactor this out into a separate ADR?

UI Components with event hooks. 

*In increasing order of dev customizability (left to right)*

Not very customizable:
- Ribbon 
- LeftView (each conversation)

Somewhat customizable:
- MainView (renders conversation.md)
```js 
view.addComponent // to embed custom UI components, e.g. images.
```

Very customizable:
- rightView
```js
field_1 = view.add(textInputComponent)
field_1.onUpdate(myFunction)
```
> Q: do components have their own events? must have right?

## Examples

### Example: Conversation with Jan where user picks model

- Decision: Don't allow them to switch mid-conversation (but allow them to choose before they start)
- How do we enable conversations to have RAG and attachments?
    - If they upload a PDF, then it packages embeddings specific to that model + convo
    - Should this be a separate convo? (and where do we store the embedding)

```sh
/.jan
    /conversations
        /jan-160298192
            jan-160298192.md          # conversation log
            jan-160298192.faiss       # embeddings 
            Modelfile                 # convo-level model settings
            /static
                img123.jpeg           # uploads from user    
```

```
# jan-16298192.md
---
model: codellama-7b-gguf-thebloke.bin
---

[User]:

asdf

![](./)

<!-- 

Uploaded 
-->
```

- How do App developers define which models that can be used

```
# Modelfile (inspired by Ollama)
MODELS *
MODELS Codellama ^13b ^q3

TEMPERATURE 1

```

### Example: Someone implementing the "base" Jan app on Jan SDK
```js
// jan/index.js

constructor() {
    ...
}

// App lifecycle events
onLoad() {
    // Here is where we define views? or onLoad()?
    this.MainView...
    this.RightView.add([...]) 
}

// Conversation events
onConversationStarted(conversation, ...) {
    conversation.send("Hi how can I help?")
}

onMessageReceived(message, ...) {
    // invoke nitro
    const res = await this.model.generate(message...)

    // can users explicitly send instead of using event?
    message.convo.send(res)
}

--- 
    
// jan/app.yaml (app manifest)
name: "Jan" // Character name
// How do devs specify what models they are compatible with?
compatible_models: ... ???

---

// Modelfile
system: "No nsfw"
parameter: ...

```
### Example: Create AI girlfriend
- Only works with a whitelist of models
- Only needs to change system prompt and model params
```js
// index.js
...

// ModelFile
...
```

### Example: Making a 


### Example: Making a compliance agent checks for PII
- Needs to intercept messages before send and receive

```js 
// index.js

```

### Example: Making a character with a knowledge base (pdf, docs)
- Needs file access
```js
// index.js

```


### Example: Making a SD chatbot (new model)
- ... 

---

## Appendix

## Why?

- **Status Quo:** Jan's current data structure is very convoluted
    - Relationship between `Convos`, `Models`, `Bots` is messy
    - Database migrations are difficult and dangerous to execute
    - Technical debt from multiple pivots
- **Goal:** Jan that derives state from filesystem
    - Clean abstractions == highly maintainable and extensible
    - e.g. Obsidian: non-proprietary files on local filesystem

## How

- **Crazy Idea:** Move to a file-based approach
    - `/convos` hold convos in Markdown format
    - `/models` hold models in `.bin` format
    - `/characters` hold characters
    - `/plugins` hold plugins
- **Default App**: Jan is a default "App"
    - `MODEL *` Allows you to select any model you have downloaded

## Possible Approach

### File Hierarchy

```sh=
.jan
    /models         # .bin files
    /plugins        # system-wide plugins
    /themes         # .css, etc
    /conversations  # Markdown-based convos
    /apps     # "characters"
        /jim
        /luffy
```

```=
├── .jan
     ├── /models
          ├── /llama2
                ├── /llama2-70b-gguf-thebloke.bin
                ├── /llama2-60b-gguf-thebloke.bin
                ├──Modelfile     # Default settings for llama2
    ├── /plugins
        ├── inference-stats
        ├── whisper
    ├── /themes
        ├── solarized-dark
    ├── /conversations
        ├── jan-1698550546.md
    ├── /apps
        ├── /jan
            ├── Modelfile        # Ollama Modelfile
            ├── Jan.yaml         # Plugin manifest        
            ├── /embeddings
                ├── jan.faiss
            ├── /src
                ├── index.ts
                ├── module.ts
                ├── ingest.ts
            ├── /resources
                ├── custom-data.pdf
                ├── custom-data.md
        ├── /jim
        ├── /ashley
```

### Conversations

```markdown=
--- new session ---

[John] xxx

[User] yyy

<!-- metadata

inference:
	tokens-per-sec: 12.21

-->
```

## Decision

What is the change that we're proposing and/or doing?

## Consequences

What becomes easier or more difficult to do because of this change?

## Alternatives

## Reference

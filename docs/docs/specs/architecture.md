---
title: Architecture
---

:::warning

This page is still under construction, and should be read as a scratchpad

:::

- Jan is built using modules
- Plugin architecture (on Pluggable-Electron)

Jan is comprised of system-level modules that mirror OpenAI’s, exposing similar APIs and objects

- Modules are modular, atomic implementations of a single OpenAI-compatible endpoint
- Modules can be swapped out for alternate implementations
  - The default `messages` module persists messages in thread-specific `.json`
  - `messages-postgresql` uses Postgres for production-grade cloud-native environments

| Jan Module | Description   | API Docs                     |
| ---------- | ------------- | ---------------------------- |
| Chat       | Inference     | [/chat](/api/chat)           |
| Models     | Models        | [/model](/api/model)         |
| Assistants | Apps          | [/assistant](/api/assistant) |
| Threads    | Conversations | [/thread](/api/thread)       |
| Messages   | Messages      | [/message](/api/message)     |

## Concepts

```mermaid
graph LR
    A1[("A User Integrators")] -->|uses| B1[assistant]
    B1 -->|persist conversational history| C1[("thread A")]
    B1 -->|executes| D1[("built-in tools as module")]
    B1 -.->|uses| E1[model]
    E1 -.->|model.json| D1
    D1 --> F1[retrieval]
    F1 -->|belongs to| G1[("web browsing")]
    G1 --> H1[Google]
    G1 --> H2[Duckduckgo]
    F1 -->|belongs to| I1[("API calling")]
    F1 --> J1[("knowledge files")]
```
- User/ Integrator
- Assistant object
- Model object
- Thread object
- Built-in tool object

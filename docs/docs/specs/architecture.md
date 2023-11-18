---
title: Architecture
---

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

## File system
```sh
janroot/
	assistants/
		assistant-a/
			assistant.json
			src/
				index.ts
			threads/
				thread-a/
				thread-b
	models/
		model-a/
			model.json
```
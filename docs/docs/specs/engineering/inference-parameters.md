---
title: "Inference Parameters"
slug: /specs/inference-parameters
description: Exhaustive list of json-schema for engine and models
---

# model_parameters

```js

{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "required": ["messages"],
  "properties": {
    "messages": {
      "type": "array",
      "items": {
        "type": "object"
      }
    },
    "model": {
      "type": "string"
    },
    "frequency_penalty": {
      "type": ["number", "null"],
      "minimum": -2.0,
      "maximum": 2.0,
      "default": 0
    },
    "logit_bias": {
      "type": ["object", "null"],
      "additionalProperties": {
        "type": "number",
        "minimum": -100,
        "maximum": 100
      },
      "default": null
    },
    "max_tokens": {
      "type": ["integer", "null"]
    },
    "n": {
      "type": ["integer", "null"],
      "default": 1
    },
    "presence_penalty": {
      "type": ["number", "null"],
      "minimum": -2.0,
      "maximum": 2.0,
      "default": 0
    },
    "response_format": {
      "type": ["object", "null"],
      "properties": {
        "type": {
          "type": "string"
        }
      }
    },
    "seed": {
      "type": ["integer", "null"]
    },
    "stop": {
      "type": ["string", "array", "null"],
      "items": {
        "type": "string"
      }
    },
    "stream": {
      "type": ["boolean", "null"],
      "default": false
    },
    "temperature": {
      "type": ["number", "null"],
      "minimum": 0,
      "maximum": 2,
      "default": 1
    },
    "top_p": {
      "type": ["number", "null"],
      "minimum": 0,
      "maximum": 1,
      "default": 1
    },
    "tools": {
      "type": ["array", "null"],
      "items": {
        "type": "object"
      }
    },
    "tool_choice": {
      "type": ["string", "object", "null"]
    },
    "user": {
      "type": ["string", "null"]
    },
    "function_call": {
      "type": ["string", "object", "null"],
      "deprecated": true
    },
    "functions": {
      "type": ["array", "null"],
      "items": {
        "type": "object"
      },
      "deprecated": true
    }
  }
}

```

# nitro engine_parameters

```js
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "properties": {
    "pre_prompt": {
      "type": "string",
      "description": "The prompt to use for internal configuration."
    },
    "system_prompt": {
      "type": "string",
      "description": "The prefix for system prompt."
    },
    "user_prompt": {
      "type": "string",
      "description": "The prefix for user prompt."
    },
    "ai_prompt": {
      "type": "string",
      "description": "The prefix for assistant prompt."
    },
    "ngl": {
      "type": "integer",
      "default": 100,
      "minimum": 0,
      "maximum": 100,
      "description": "The number of layers to load onto the GPU for acceleration."
    },
    "ctx_len": {
      "type": "integer",
      "default": 2048,
      "minimum": 128,
      "maximum": 4096,
      "description": "The context length for model operations varies; the maximum depends on the specific model used."
    },
    "n_parallel": {
      "type": "integer",
      "default": 1,
      "description": "The number of parallel operations. Only set when enable continuous batching."
    },
    "cont_batching": {
      "type": "boolean",
      "default": false,
      "description": "Whether to use continuous batching."
    },
    "cpu_threads": {
      "type": "integer",
      "description": "The number of threads for CPU-based inference."
    },
    "embedding": {
      "type": "boolean",
      "description": "Whether to enable embedding."
    }
  }
}
```

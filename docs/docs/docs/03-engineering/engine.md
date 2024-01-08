---
title: Engine
---

:::caution

Currently Under Development

:::

## Overview

In the Jan application, engines serve as primary entities with the following capabilities:

- Engine will be installed through `inference-extensions`.
- Models will depend on engines to do [inference](https://en.wikipedia.org/wiki/Inference_engine).
- Engine configuration and required metadata will be stored in a json file.

## Folder Structure

- Default parameters for engines are stored in JSON files located in the `/engines` folder.
- These parameter files are named uniquely with `engine_id`.
- Engines are referenced directly using `engine_id` in the `model.json` file.

```yaml
jan/
engines/
nitro.json
openai.json
.....
```

## Engine Default Parameter Files

- Each inference engine requires default parameters to function in cases where user-provided parameters are absent.
- These parameters are stored in JSON files, structured as simple key-value pairs.

### Example

Here is an example of an engine file for `engine_id` `nitro`:

```js
{
    "ctx_len": 512,
    "ngl": 100,
    "embedding": false,
    "n_parallel": 1,
    "cont_batching": false
    "prompt_template": "<|im_start|>system\n{system_message}<|im_end|>\n<|im_start|>user\n{prompt}<|im_end|>\n<|im_start|>assistant"
}
```

For detailed engine parameters, refer to: [Nitro's Model Settings](https://nitro.jan.ai/features/load-unload#table-of-parameters)

## Adding an Engine

- Engine parameter files are automatically generated upon installing an `inference-extension` in the Jan application.

---

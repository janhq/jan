# Update Gemma 4 chat template (llama.cpp)

When llama-server logs:

`common_chat_try_specialized_template: detected an outdated gemma4 chat template`

the bundled `tokenizer_config.json` / `chat_template.jinja` in the model directory is stale.

## Fix

1. Open the model folder under Jan data, e.g.  
   `~/Library/Application Support/Atomic Chat/data/llamacpp/models/<model-id>/`
2. Copy fresh `tokenizer_config.json` and `chat_template.jinja` from the upstream Hugging Face model card for that quant.
3. Restart the llama.cpp session.

This removes per-request compatibility workarounds and keeps prefix-cache keys stable across app versions.

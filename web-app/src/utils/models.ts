export const hardcodedModel = {
  author: 'Menlo',
  id: 'https://huggingface.co/Menlo/Jan-nano',
  metadata: {
    '_id': '68492cd9cada68b1d11ca1bd',
    'author': 'Menlo',
    'cardData': {
      license: 'apache-2.0',
      pipeline_tag: 'text-generation',
    },
    'createdAt': '2025-06-11T07:14:33.000Z',
    'description':
      '---\nlicense: apache-2.0\npipeline_tag: text-generation\n---\n# Jan Nano\n\n\n\n![image/png](https://cdn-uploads.huggingface.co/production/uploads/657a81129ea9d52e5cbd67f7/YQci8jiHjAAFpXWYOadrU.png)\n\n## Overview\n\nJan Nano is a fine-tuned language model built on top of the Qwen3 architecture. Developed as part of the Jan ecosystem, it balances compact size and extended context length, making it ideal for efficient, high-quality text generation in local or embedded environments.\n\n## Features\n\n- **Tool Use**: Excellent function calling and tool integration\n- **Research**: Enhanced research and information processing capabilities\n- **Small Model**: VRAM efficient for local deployment\n\n## Use it with Jan (UI)\n\n1. Install **Jan** using [Quickstart](https://jan.ai/docs/quickstart)',
    'disabled': false,
    'downloads': 0,
    'gated': false,
    'gguf': {
      architecture: 'qwen3',
      bos_token: '<|endoftext|>',
      chat_template:
        "{%- if tools %}\n    {{- '<|im_start|>system\\n' }}\n    {%- if messages[0].role == 'system' %}\n        {{- messages[0].content + '\\n\\n' }}\n    {%- endif %}\n    {{- \"# Tools\\n\\nYou may call one or more functions to assist with the user query.\\n\\nYou are provided with function signatures within <tools></tools> XML tags:\\n<tools>\" }}\n    {%- for tool in tools %}\n        {{- \"\\n\" }}\n        {{- tool | tojson }}\n    {%- endfor %}\n    {{- \"\\n</tools>\\n\\nFor each function call, return a json object with function name and arguments within <tool_call></tool_call> XML tags:\\n<tool_call>\\n{\\\"name\\\": <function-name>, \\\"arguments\\\": <args-json-object>}\\n</tool_call><|im_end|>\\n\" }}\n{%- else %}\n    {%- if messages[0].role == 'system' %}\n        {{- '<|im_start|>system\\n' + messages[0].content + '<|im_end|>\\n' }}\n    {%- endif %}\n{%- endif %}\n{%- set ns = namespace(multi_step_tool=true, last_query_index=messages|length - 1) %}\n{%- for message in messages[::-1] %}\n    {%- set index = (messages|length - 1) - loop.index0 %}\n    {%- if ns.multi_step_tool and message.role == \"user\" and message.content is string and not(message.content.startswith('<tool_response>') and message.content.endswith('</tool_response>')) %}\n        {%- set ns.multi_step_tool = false %}\n        {%- set ns.last_query_index = index %}\n    {%- endif %}\n{%- endfor %}\n{%- for message in messages %}\n    {%- if message.content is string %}\n        {%- set content = message.content %}\n    {%- else %}\n        {%- set content = '' %}\n    {%- endif %}\n    {%- if (message.role == \"user\") or (message.role == \"system\" and not loop.first) %}\n        {{- '<|im_start|>' + message.role + '\\n' + content + '<|im_end|>' + '\\n' }}\n    {%- elif message.role == \"assistant\" %}\n        {%- set reasoning_content = '' %}\n        {%- if message.reasoning_content is string %}\n            {%- set reasoning_content = message.reasoning_content %}\n        {%- else %}\n            {%- if '</think>' in content %}\n                {%- set reasoning_content = content.split('</think>')[0].rstrip('\\n').split('<think>')[-1].lstrip('\\n') %}\n                {%- set content = content.split('</think>')[-1].lstrip('\\n') %}\n            {%- endif %}\n        {%- endif %}\n        {%- if loop.index0 > ns.last_query_index %}\n            {%- if loop.last or (not loop.last and reasoning_content) %}\n                {{- '<|im_start|>' + message.role + '\\n<think>\\n' + reasoning_content.strip('\\n') + '\\n</think>\\n\\n' + content.lstrip('\\n') }}\n            {%- else %}\n                {{- '<|im_start|>' + message.role + '\\n' + content }}\n            {%- endif %}\n        {%- else %}\n            {{- '<|im_start|>' + message.role + '\\n' + content }}\n        {%- endif %}\n        {%- if message.tool_calls %}\n            {%- for tool_call in message.tool_calls %}\n                {%- if (loop.first and content) or (not loop.first) %}\n                    {{- '\\n' }}\n                {%- endif %}\n                {%- if tool_call.function %}\n                    {%- set tool_call = tool_call.function %}\n                {%- endif %}\n                {{- '<tool_call>\\n{\"name\": \"' }}\n                {{- tool_call.name }}\n                {{- '\", \"arguments\": ' }}\n                {%- if tool_call.arguments is string %}\n                    {{- tool_call.arguments }}\n                {%- else %}\n                    {{- tool_call.arguments | tojson }}\n                {%- endif %}\n                {{- '}\\n</tool_call>' }}\n            {%- endfor %}\n        {%- endif %}\n        {{- '<|im_end|>\\n' }}\n    {%- elif message.role == \"tool\" %}\n        {%- if loop.first or (messages[loop.index0 - 1].role != \"tool\") %}\n            {{- '<|im_start|>user' }}\n        {%- endif %}\n        {{- '\\n<tool_response>\\n' }}\n        {{- content }}\n        {{- '\\n</tool_response>' }}\n        {%- if loop.last or (messages[loop.index0 + 1].role != \"tool\") %}\n            {{- '<|im_end|>\\n' }}\n        {%- endif %}\n    {%- endif %}\n{%- endfor %}\n{%- if add_generation_prompt %}\n    {{- '<|im_start|>assistant\\n<think>\\n\\n</think>\\n\\n' }}\n{%- endif %}",
      context_length: 40960,
      eos_token: '<|im_end|>',
      total: 4022468096,
    },
    'id': 'Menlo/Jan-nano',
    'lastModified': '2025-06-11T10:42:16.000Z',
    'likes': 2,
    'model-index': null,
    'modelId': 'Menlo/Jan-nano',
    'pipeline_tag': 'text-generation',
    'private': false,
    'sha': 'f05b9e798d3cb66394a25d2a45cdc77fd1d5a3ba',
    'siblings': [
      {
        rfilename: '.gitattributes',
        size: 1681,
      },
      {
        rfilename: 'Jan-nano_q4_k_m.gguf',
        size: 2497280288,
      },
      {
        rfilename: 'Jan-nano_q8_0.gguf',
        size: 4280400640,
      },
      {
        rfilename: 'README.md',
        size: 776,
      },
    ],
    'spaces': [],
    'tags': [
      'gguf',
      'text-generation',
      'license:apache-2.0',
      'endpoints_compatible',
      'region:us',
      'conversational',
    ],
    'usedStorage': 11772241536,
    'widgetData': [
      {
        text: 'Hi, what can you help me with?',
      },
      {
        text: 'What is 84 * 3 / 2?',
      },
      {
        text: 'Tell me an interesting fact about the universe!',
      },
      {
        text: 'Explain quantum computing in simple terms.',
      },
    ],
  },
  models: [
    {
      id: 'Menlo:Jan-nano:Jan-nano_q4_k_m.gguf',
      size: 2497280288,
    },
    {
      id: 'Menlo:Jan-nano:Jan-nano_q8_0.gguf',
      size: 4280400640,
    },
  ],
}

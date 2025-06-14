export const hardcodedModel = {
  author: 'menlo',
  id: 'menlo/jan-nano',
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
    'downloads': 1434,
    'gated': false,
    'gguf': {
      architecture: 'qwen3',
      bos_token: '<|endoftext|>',
      chat_template:
        "{%- if tools %} {{- '<|im_start|>system\\n' }} {%- if messages[0].role == 'system' %} {{- messages[0].content + '\\n\\n' }} {%- endif %} {{- \"# Tools\\n\\nYou may call one or more functions to assist with the user query.\\n\\nYou are provided with function signatures within <tools></tools> XML tags:\\n<tools>\" }} {%- for tool in tools %} {{- \"\\n\" }} {{- tool | tojson }} {%- endfor %} {{- \"\\n</tools>\\n\\nFor each function call, return a json object with function name and arguments within <tool_call></tool_call> XML tags:\\n<tool_call>\\n{\\\"name\\\": <function-name>, \\\"arguments\\\": <args-json-object>}\\n</tool_call><|im_end|>\\n\" }} {%- else %} {%- if messages[0].role == 'system' %} {{- '<|im_start|>system\\n' + messages[0].content + '<|im_end|>\\n' }} {%- endif %} {%- endif %} {%- set ns = namespace(multi_step_tool=true, last_query_index=messages|length - 1) %} {%- for message in messages[::-1] %} {%- set index = (messages|length - 1) - loop.index0 %} {%- if ns.multi_step_tool and message.role == \"user\" and message.content is string and not(message.content.startswith('<tool_response>') and message.content.endswith('</tool_response>')) %} {%- set ns.multi_step_tool = false %} {%- set ns.last_query_index = index %} {%- endif %} {%- endfor %} {%- for message in messages %} {%- if message.content is string %} {%- set content = message.content %} {%- else %} {%- set content = '' %} {%- endif %} {%- if (message.role == \"user\") or (message.role == \"system\" and not loop.first) %} {{- '<|im_start|>' + message.role + '\\n' + content + '<|im_end|>' + '\\n' }} {%- elif message.role == \"assistant\" %} {%- set reasoning_content = '' %} {%- if message.reasoning_content is string %} {%- set reasoning_content = message.reasoning_content %} {%- else %} {%- if '</think>' in content %} {%- set reasoning_content = content.split('</think>')[0].rstrip('\\n').split('<think>')[-1].lstrip('\\n') %} {%- set content = content.split('</think>')[-1].lstrip('\\n') %} {%- endif %} {%- endif %} {%- if loop.index0 > ns.last_query_index %} {%- if loop.last or (not loop.last and reasoning_content) %} {{- '<|im_start|>' + message.role + '\\n<think>\\n' + reasoning_content.strip('\\n') + '\\n</think>\\n\\n' + content.lstrip('\\n') }} {%- else %} {{- '<|im_start|>' + message.role + '\\n' + content }} {%- endif %} {%- else %} {{- '<|im_start|>' + message.role + '\\n' + content }} {%- endif %} {%- if message.tool_calls %} {%- for tool_call in message.tool_calls %} {%- if (loop.first and content) or (not loop.first) %} {{- '\\n' }} {%- endif %} {%- if tool_call.function %} {%- set tool_call = tool_call.function %} {%- endif %} {{- '<tool_call>\\n{\"name\": \"' }} {{- tool_call.name }} {{- '\", \"arguments\": ' }} {%- if tool_call.arguments is string %} {{- tool_call.arguments }} {%- else %} {{- tool_call.arguments | tojson }} {%- endif %} {{- '}\\n</tool_call>' }} {%- endfor %} {%- endif %} {{- '<|im_end|>\\n' }} {%- elif message.role == \"tool\" %} {%- if loop.first or (messages[loop.index0 - 1].role != \"tool\") %} {{- '<|im_start|>user' }} {%- endif %} {{- '\\n<tool_response>\\n' }} {{- content }} {{- '\\n</tool_response>' }} {%- if loop.last or (messages[loop.index0 + 1].role != \"tool\") %} {{- '<|im_end|>\\n' }} {%- endif %} {%- endif %} {%- endfor %} {%- if add_generation_prompt %} {{- '<|im_start|>assistant\\n' }} {{- '<think>\\n\\n</think>\\n\\n' }} {%- endif %}",
      context_length: 40960,
      eos_token: '<|im_end|>',
      quantize_imatrix_file: 'imatrix.dat',
      total: 4022468096,
    },
    'id': 'Menlo/Jan-nano',
    'lastModified': '2025-06-13T16:57:55.000Z',
    'likes': 3,
    'model-index': null,
    'modelId': 'Menlo/Jan-nano',
    'pipeline_tag': 'text-generation',
    'private': false,
    'sha': 'a04aab0878648d8f284c63a52664a482ead16f06',
    'siblings': [
      {
        rfilename: '.gitattributes',
        size: 3460,
      },
      {
        rfilename: 'README.md',
        size: 776,
      },
      {
        rfilename: 'jan-nano-0.4-iQ4_XS.gguf',
        size: 2270750400,
      },
      {
        rfilename: 'jan-nano-4b-Q3_K_L.gguf',
        size: 2239784384,
      },
      {
        rfilename: 'jan-nano-4b-Q3_K_M.gguf',
        size: 2075616704,
      },
      {
        rfilename: 'jan-nano-4b-Q3_K_S.gguf',
        size: 1886995904,
      },
      {
        rfilename: 'jan-nano-4b-Q4_0.gguf',
        size: 2369545664,
      },
      {
        rfilename: 'jan-nano-4b-Q4_1.gguf',
        size: 2596627904,
      },
      {
        rfilename: 'jan-nano-4b-Q4_K_M.gguf',
        size: 2497279424,
      },
      {
        rfilename: 'jan-nano-4b-Q4_K_S.gguf',
        size: 2383308224,
      },
      {
        rfilename: 'jan-nano-4b-Q5_0.gguf',
        size: 2823710144,
      },
      {
        rfilename: 'jan-nano-4b-Q5_1.gguf',
        size: 3050792384,
      },
      {
        rfilename: 'jan-nano-4b-Q5_K_M.gguf',
        size: 2889512384,
      },
      {
        rfilename: 'jan-nano-4b-Q5_K_S.gguf',
        size: 2823710144,
      },
      {
        rfilename: 'jan-nano-4b-Q6_K.gguf',
        size: 3306259904,
      },
      {
        rfilename: 'jan-nano-4b-Q8_0.gguf',
        size: 4280403904,
      },
    ],
    'spaces': [],
    'tags': [
      'gguf',
      'text-generation',
      'license:apache-2.0',
      'endpoints_compatible',
      'region:us',
      'imatrix',
      'conversational',
    ],
    'usedStorage': 93538518464,
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
      id: 'menlo:jan-nano:jan-nano-0.4-iQ4_XS.gguf',
      size: 2270750400,
    },
    {
      id: 'menlo:jan-nano:jan-nano-4b-Q3_K_L.gguf',
      size: 2239784384,
    },
    {
      id: 'menlo:jan-nano:jan-nano-4b-Q3_K_M.gguf',
      size: 2075616704,
    },
    {
      id: 'menlo:jan-nano:jan-nano-4b-Q3_K_S.gguf',
      size: 1886995904,
    },
    {
      id: 'menlo:jan-nano:jan-nano-4b-Q4_0.gguf',
      size: 2369545664,
    },
    {
      id: 'menlo:jan-nano:jan-nano-4b-Q4_1.gguf',
      size: 2596627904,
    },
    {
      id: 'menlo:jan-nano:jan-nano-4b-Q4_K_M.gguf',
      size: 2497279424,
    },
    {
      id: 'menlo:jan-nano:jan-nano-4b-Q4_K_S.gguf',
      size: 2383308224,
    },
    {
      id: 'menlo:jan-nano:jan-nano-4b-Q5_0.gguf',
      size: 2823710144,
    },
    {
      id: 'menlo:jan-nano:jan-nano-4b-Q5_1.gguf',
      size: 3050792384,
    },
    {
      id: 'menlo:jan-nano:jan-nano-4b-Q5_K_M.gguf',
      size: 2889512384,
    },
    {
      id: 'menlo:jan-nano:jan-nano-4b-Q5_K_S.gguf',
      size: 2823710144,
    },
    {
      id: 'menlo:jan-nano:jan-nano-4b-Q6_K.gguf',
      size: 3306259904,
    },
    {
      id: 'menlo:jan-nano:jan-nano-4b-Q8_0.gguf',
      size: 4280403904,
    },
  ],
}

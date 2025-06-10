export const hardcodedModel = {
  author: 'jan-ai',
  id: 'https://huggingface.co/jan-ai/qwen3-4b-v0.3-deepresearch-100-step-gguf',
  metadata: {
    _id: '6847d3248ff5133923d65a3f',
    author: 'jan-ai',
    createdAt: '2025-06-10T06:39:32.000Z',
    description:
      'Jan Nano 4B is a powerful and efficient language model optimized for local deployment. Built on the Qwen3 architecture with 4 billion parameters, this model delivers excellent performance for conversational AI, reasoning tasks, and general text generation while maintaining fast inference speeds on consumer hardware.',
    disabled: false,
    downloads: 0,
    gated: false,
    gguf: {
      architecture: 'qwen3',
      bos_token: '<|endoftext|>',
      chat_template:
        "{%- if tools %} {{- '<|im_start|>system\\n' }} {%- if messages[0].role == 'system' %} {{- messages[0].content + '\\n\\n' }} {%- endif %} {{- \"# Tools\\n\\nYou may call one or more functions to assist with the user query.\\n\\nYou are provided with function signatures within <tools></tools> XML tags:\\n<tools>\" }} {%- for tool in tools %} {{- \"\\n\" }} {{- tool | tojson }} {%- endfor %} {{- \"\\n</tools>\\n\\nFor each function call, return a json object with function name and arguments within <tool_call></tool_call> XML tags:\\n<tool_call>\\n{\\\"name\\\": <function-name>, \\\"arguments\\\": <args-json-object>}\\n</tool_call><|im_end|>\\n\" }} {%- else %} {%- if messages[0].role == 'system' %} {{- '<|im_start|>system\\n' + messages[0].content + '<|im_end|>\\n' }} {%- endif %} {%- endif %} {%- set ns = namespace(multi_step_tool=true, last_query_index=messages|length - 1) %} {%- for message in messages[::-1] %} {%- set index = (messages|length - 1) - loop.index0 %} {%- if ns.multi_step_tool and message.role == \"user\" and message.content is string and not(message.content.startswith('<tool_response>') and message.content.endswith('</tool_response>')) %} {%- set ns.multi_step_tool = false %} {%- set ns.last_query_index = index %} {%- endif %} {%- endfor %} {%- for message in messages %} {%- if message.content is string %} {%- set content = message.content %} {%- else %} {%- set content = '' %} {%- endif %} {%- if (message.role == \"user\") or (message.role == \"system\" and not loop.first) %} {{- '<|im_start|>' + message.role + '\\n' + content + '<|im_end|>' + '\\n' }} {%- elif message.role == \"assistant\" %} {%- set reasoning_content = '' %} {%- if message.reasoning_content is string %} {%- set reasoning_content = message.reasoning_content %} {%- else %} {%- if '</think>' in content %} {%- set reasoning_content = content.split('</think>')[0].rstrip('\\n').split('<think>')[-1].lstrip('\\n') %} {%- set content = content.split('</think>')[-1].lstrip('\\n') %} {%- endif %} {%- endif %} {%- if loop.index0 > ns.last_query_index %} {%- if loop.last or (not loop.last and reasoning_content) %} {{- '<|im_start|>' + message.role + '\\n<think>\\n' + reasoning_content.strip('\\n') + '\\n</think>\\n\\n' + content.lstrip('\\n') }} {%- else %} {{- '<|im_start|>' + message.role + '\\n' + content }} {%- endif %} {%- else %} {{- '<|im_start|>' + message.role + '\\n' + content }} {%- endif %} {%- if message.tool_calls %} {%- for tool_call in message.tool_calls %} {%- if (loop.first and content) or (not loop.first) %} {{- '\\n' }} {%- endif %} {%- if tool_call.function %} {%- set tool_call = tool_call.function %} {%- endif %} {{- '<tool_call>\\n{\"name\": \"' }} {{- tool_call.name }} {{- '\", \"arguments\": ' }} {%- if tool_call.arguments is string %} {{- tool_call.arguments }} {%- else %} {{- tool_call.arguments | tojson }} {%- endif %} {{- '}\\n</tool_call>' }} {%- endfor %} {%- endif %} {{- '<|im_end|>\\n' }} {%- elif message.role == \"tool\" %} {%- if loop.first or (messages[loop.index0 - 1].role != \"tool\") %} {{- '<|im_start|>user' }} {%- endif %} {{- '\\n<tool_response>\\n' }} {{- content }} {{- '\\n</tool_response>' }} {%- if loop.last or (messages[loop.index0 + 1].role != \"tool\") %} {{- '<|im_end|>\\n' }} {%- endif %} {%- endif %} {%- endfor %} {%- if add_generation_prompt %} {{- '<|im_start|>assistant\\n' }} {{- '<think>\\n\\n</think>\\n\\n' }} {%- endif %}",
      context_length: 40960,
      eos_token: '<|im_end|>',
      total: 4022468096,
    },
    id: 'jan-ai/qwen3-4b-v0.3-deepresearch-100-step-gguf',
    lastModified: '2025-06-10T06:46:48.000Z',
    likes: 0,
    modelId: 'jan-ai/qwen3-4b-v0.3-deepresearch-100-step-gguf',
    private: false,
    sha: '105c59239e057320c6941643523f9311c3ba7f86',
    siblings: [
      {
        rfilename: '.gitattributes',
        size: 2469,
      },
      {
        rfilename: 'jan-nano-4B-v0.3-100-step-Q3_K_L.gguf',
        size: 2239784384,
      },
      {
        rfilename: 'jan-nano-4B-v0.3-100-step-Q3_K_M.gguf',
        size: 2075616704,
      },
      {
        rfilename: 'jan-nano-4B-v0.3-100-step-Q3_K_S.gguf',
        size: 1886995904,
      },
      {
        rfilename: 'jan-nano-4B-v0.3-100-step-Q4_0.gguf',
        size: 2369545664,
      },
      {
        rfilename: 'jan-nano-4B-v0.3-100-step-Q4_1.gguf',
        size: 2596627904,
      },
      {
        rfilename: 'jan-nano-4B-v0.3-100-step-Q4_K_M.gguf',
        size: 2497279424,
      },
      {
        rfilename: 'jan-nano-4B-v0.3-100-step-Q4_K_S.gguf',
        size: 2383308224,
      },
      {
        rfilename: 'jan-nano-4B-v0.3-100-step-Q5_0.gguf',
        size: 2823710144,
      },
      {
        rfilename: 'jan-nano-4B-v0.3-100-step-Q5_1.gguf',
        size: 3050792384,
      },
      {
        rfilename: 'jan-nano-4B-v0.3-100-step-Q5_K_M.gguf',
        size: 2889512384,
      },
      {
        rfilename: 'jan-nano-4B-v0.3-100-step-Q5_K_S.gguf',
        size: 2823710144,
      },
      {
        rfilename: 'jan-nano-4B-v0.3-100-step-Q6_K.gguf',
        size: 3306259904,
      },
      {
        rfilename: 'jan-nano-4B-v0.3-100-step-Q8_0.gguf',
        size: 4280403904,
      },
    ],
    spaces: [],
    tags: ['gguf', 'endpoints_compatible', 'region:us', 'conversational'],
    usedStorage: 35223547072,
  },
  models: [
    {
      id: 'jan-ai:qwen3-4b-v0.3-deepresearch-100-step-gguf:jan-nano-4B-v0.3-100-step-Q3_K_L.gguf',
      size: 2239784384,
    },
    {
      id: 'jan-ai:qwen3-4b-v0.3-deepresearch-100-step-gguf:jan-nano-4B-v0.3-100-step-Q3_K_M.gguf',
      size: 2075616704,
    },
    {
      id: 'jan-ai:qwen3-4b-v0.3-deepresearch-100-step-gguf:jan-nano-4B-v0.3-100-step-Q3_K_S.gguf',
      size: 1886995904,
    },
    {
      id: 'jan-ai:qwen3-4b-v0.3-deepresearch-100-step-gguf:jan-nano-4B-v0.3-100-step-Q4_0.gguf',
      size: 2369545664,
    },
    {
      id: 'jan-ai:qwen3-4b-v0.3-deepresearch-100-step-gguf:jan-nano-4B-v0.3-100-step-Q4_1.gguf',
      size: 2596627904,
    },
    {
      id: 'jan-ai:qwen3-4b-v0.3-deepresearch-100-step-gguf:jan-nano-4B-v0.3-100-step-Q4_K_M.gguf',
      size: 2497279424,
    },
    {
      id: 'jan-ai:qwen3-4b-v0.3-deepresearch-100-step-gguf:jan-nano-4B-v0.3-100-step-Q4_K_S.gguf',
      size: 2383308224,
    },
    {
      id: 'jan-ai:qwen3-4b-v0.3-deepresearch-100-step-gguf:jan-nano-4B-v0.3-100-step-Q5_0.gguf',
      size: 2823710144,
    },
    {
      id: 'jan-ai:qwen3-4b-v0.3-deepresearch-100-step-gguf:jan-nano-4B-v0.3-100-step-Q5_1.gguf',
      size: 3050792384,
    },
    {
      id: 'jan-ai:qwen3-4b-v0.3-deepresearch-100-step-gguf:jan-nano-4B-v0.3-100-step-Q5_K_M.gguf',
      size: 2889512384,
    },
    {
      id: 'jan-ai:qwen3-4b-v0.3-deepresearch-100-step-gguf:jan-nano-4B-v0.3-100-step-Q5_K_S.gguf',
      size: 2823710144,
    },
    {
      id: 'jan-ai:qwen3-4b-v0.3-deepresearch-100-step-gguf:jan-nano-4B-v0.3-100-step-Q6_K.gguf',
      size: 3306259904,
    },
    {
      id: 'jan-ai:qwen3-4b-v0.3-deepresearch-100-step-gguf:jan-nano-4B-v0.3-100-step-Q8_0.gguf',
      size: 4280403904,
    },
  ],
}

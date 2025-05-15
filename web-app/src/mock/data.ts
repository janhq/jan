export const mockModelProvider = [
  // {
  //   active: true,
  //   provider: 'llama.cpp',
  //   settings: [
  //     {
  //       key: 'cont_batching',
  //       title: 'Continuous Batching',
  //       description:
  //         'Allows processing prompts in parallel with text generation, which usually improves performance.',
  //       controller_type: 'checkbox',
  //       controller_props: {
  //         value: true,
  //       },
  //     },
  //     {
  //       key: 'n_parallel',
  //       title: 'Parallel Operations',
  //       description:
  //         'Number of prompts that can be processed simultaneously by the model.',
  //       controller_type: 'input',
  //       controller_props: {
  //         value: '4',
  //         placeholder: '4',
  //         type: 'number',
  //       },
  //     },
  //     {
  //       key: 'cpu_threads',
  //       title: 'CPU Threads',
  //       description:
  //         'Number of CPU cores used for model processing when running without GPU.',
  //       controller_type: 'input',
  //       controller_props: {
  //         value: '1',
  //         placeholder: '1',
  //         type: 'number',
  //       },
  //     },
  //     {
  //       key: 'flash_attn',
  //       title: 'Flash Attention',
  //       description:
  //         'Optimizes memory usage and speeds up model inference using an efficient attention implementation.',
  //       controller_type: 'checkbox',
  //       controller_props: {
  //         value: true,
  //       },
  //     },

  //     {
  //       key: 'caching_enabled',
  //       title: 'Caching',
  //       description:
  //         'Stores recent prompts and responses to improve speed when similar questions are asked.',
  //       controller_type: 'checkbox',
  //       controller_props: {
  //         value: true,
  //       },
  //     },
  //     {
  //       key: 'cache_type',
  //       title: 'KV Cache Type',
  //       description: 'Controls memory usage and precision trade-off.',
  //       controller_type: 'dropdown',
  //       controller_props: {
  //         value: 'f16',
  //         options: [
  //           {
  //             value: 'q4_0',
  //             name: 'q4_0',
  //           },
  //           {
  //             value: 'q8_0',
  //             name: 'q8_0',
  //           },
  //           {
  //             value: 'f16',
  //             name: 'f16',
  //           },
  //         ],
  //       },
  //     },
  //     {
  //       key: 'use_mmap',
  //       title: 'mmap',
  //       description:
  //         'Loads model files more efficiently by mapping them to memory, reducing RAM usage.',
  //       controller_type: 'checkbox',
  //       controller_props: {
  //         value: true,
  //       },
  //     },
  //   ],
  //   models: [
  //     {
  //       id: 'llama3.2:3b',
  //       model: 'llama3.2:3b',
  //       name: 'llama3.2:3b',
  //       capabilities: ['completion', 'tools'],
  //       version: 2,
  //       settings: {
  //         prompt_template:
  //           '<|begin_of_text|><|start_header_id|>system<|end_header_id|>\n\n{system_message}<|eot_id|><|start_header_id|>user<|end_header_id|>\n\n{prompt}<|eot_id|><|start_header_id|>assistant<|end_header_id|>\n\n',
  //         ctx_len: 4096,
  //         n_parallel: 1,
  //         cpu_threads: 1,
  //         ngl: 29,
  //       },
  //     },
  //     {
  //       id: 'deepseek-r1.2:3b',
  //       model: 'deepseek-r1.2:3b',
  //       name: 'deepseek-r1.2:3b',
  //       capabilities: ['completion', 'tools'],
  //       version: 2,
  //       settings: {
  //         prompt_template:
  //           '<|begin_of_text|><|start_header_id|>system<|end_header_id|>\n\n{system_message}<|eot_id|><|start_header_id|>user<|end_header_id|>\n\n{prompt}<|eot_id|><|start_header_id|>assistant<|end_header_id|>\n\n',
  //         ctx_len: 4096,
  //         n_parallel: 1,
  //         cpu_threads: 1,
  //         ngl: 29,
  //       },
  //     },
  //   ],
  // },
  {
    active: true,
    api_key: '',
    base_url: 'https://api.openai.com/v1',
    explore_models_url: 'https://platform.openai.com/docs/models',
    provider: 'openai',
    settings: [
      {
        key: 'api-key',
        title: 'API Key',
        description:
          "The OpenAI API uses API keys for authentication. Visit your [API Keys](https://platform.openai.com/account/api-keys) page to retrieve the API key you'll use in your requests.",
        controller_type: 'input',
        controller_props: {
          placeholder: 'Insert API Key',
          value: '',
          type: 'password',
          input_actions: ['unobscure', 'copy'],
        },
      },
      {
        key: 'base-url',
        title: 'Base URL',
        description:
          'The base endpoint to use. See the [OpenAI API documentation](https://platform.openai.com/docs/api-reference/chat/create) for more information.',
        controller_type: 'input',
        controller_props: {
          placeholder: 'https://api.openai.com/v1',
          value: 'https://api.openai.com/v1',
        },
      },
    ],
    models: [],
  },
  {
    active: true,
    api_key: '',
    base_url: 'https://api.anthropic.com/v1',
    provider: 'anthropic',
    explore_models_url:
      'https://docs.anthropic.com/en/docs/about-claude/models',
    settings: [
      {
        key: 'api-key',
        title: 'API Key',
        description:
          "The Anthropic API uses API keys for authentication. Visit your [API Keys](https://console.anthropic.com/settings/keys) page to retrieve the API key you'll use in your requests.",
        controller_type: 'input',
        controller_props: {
          placeholder: 'Insert API Key',
          value: '',
          type: 'password',
          input_actions: ['unobscure', 'copy'],
        },
      },
      {
        key: 'base-url',
        title: 'Base URL',
        description:
          'The base endpoint to use. See the [Anthropic API documentation](https://docs.anthropic.com/en/api/messages) for more information.',
        controller_type: 'input',
        controller_props: {
          placeholder: 'https://api.anthropic.com/v1',
          value: 'https://api.anthropic.com/v1',
        },
      },
    ],
    models: [],
  },
  {
    active: true,
    api_key: '',
    base_url: 'https://api.cohere.ai/compatibility/v1',
    explore_models_url: 'https://docs.cohere.com/v2/docs/models',
    provider: 'cohere',
    settings: [
      {
        key: 'api-key',
        title: 'API Key',
        description:
          "The Cohere API uses API keys for authentication. Visit your [API Keys](https://dashboard.cohere.com/api-keys) page to retrieve the API key you'll use in your requests.",
        controller_type: 'input',
        controller_props: {
          placeholder: 'Insert API Key',
          value: '',
          type: 'password',
          input_actions: ['unobscure', 'copy'],
        },
      },
      {
        key: 'base-url',
        title: 'Base URL',
        description:
          'The base OpenAI-compatible endpoint to use. See the [Cohere documentation](https://docs.cohere.com/docs/compatibility-api) for more information.',
        controller_type: 'input',
        controller_props: {
          placeholder: 'https://api.cohere.ai/compatibility/v1',
          value: 'https://api.cohere.ai/compatibility/v1',
        },
      },
    ],
    models: [],
  },
  {
    active: true,
    api_key: '',
    base_url: 'https://openrouter.ai/api/v1',
    explore_models_url: 'https://openrouter.ai/models',
    provider: 'openrouter',
    settings: [
      {
        key: 'api-key',
        title: 'API Key',
        description:
          "The OpenRouter API uses API keys for authentication. Visit your [API Keys](https://openrouter.ai/settings/keys) page to retrieve the API key you'll use in your requests.",
        controller_type: 'input',
        controller_props: {
          placeholder: 'Insert API Key',
          value: '',
          type: 'password',
          input_actions: ['unobscure', 'copy'],
        },
      },
      {
        key: 'base-url',
        title: 'Base URL',
        description:
          'The base endpoint to use. See the [OpenRouter API documentation](https://openrouter.ai/docs/api-reference/overview) for more information.',
        controller_type: 'input',
        controller_props: {
          placeholder: 'https://openrouter.ai/api/v1',
          value: 'https://openrouter.ai/api/v1',
        },
      },
    ],
    models: [
      {
        id: 'deepseek/deepseek-r1:free',
        name: 'DeepSeek-R1 (free)',
        version: '1.0',
        description: '',
        capabilities: ['completion'],
      },
      {
        id: 'qwen/qwen3-30b-a3b:free',
        name: 'Qwen3 30B A3B (free)',
        version: '1.0',
        description: '',
        capabilities: ['completion'],
      },
    ],
  },
  {
    active: true,
    api_key: '',
    base_url: 'https://api.mistral.ai/v1',
    explore_models_url:
      'https://docs.mistral.ai/getting-started/models/models_overview/',
    provider: 'mistral',
    settings: [
      {
        key: 'api-key',
        title: 'API Key',
        description:
          "The Mistral API uses API keys for authentication. Visit your [API Keys](https://console.mistral.ai/api-keys/) page to retrieve the API key you'll use in your requests.",
        controller_type: 'input',
        controller_props: {
          placeholder: 'Insert API Key',
          value: '',
          type: 'password',
          input_actions: ['unobscure', 'copy'],
        },
      },
      {
        key: 'base-url',
        title: 'Base URL',
        description:
          'The base endpoint to use. See the [Mistral documentation](https://docs.mistral.ai/getting-started/models/models_overview/) for more information.',
        controller_type: 'input',
        controller_props: {
          placeholder: 'https://api.mistral.ai/v1',
          value: 'https://api.mistral.ai/v1',
        },
      },
    ],
    models: [],
  },
  {
    active: true,
    api_key: '',
    base_url: 'https://api.groq.com/openai/v1',
    explore_models_url: 'https://console.groq.com/docs/models',
    provider: 'groq',
    settings: [
      {
        key: 'api-key',
        title: 'API Key',
        description:
          "The Groq API uses API keys for authentication. Visit your [API Keys](https://console.groq.com/keys) page to retrieve the API key you'll use in your requests.",
        controller_type: 'input',
        controller_props: {
          placeholder: 'Insert API Key',
          value: '',
          type: 'password',
          input_actions: ['unobscure', 'copy'],
        },
      },
      {
        key: 'base-url',
        title: 'Base URL',
        description:
          'The base OpenAI-compatible endpoint to use. See the [Groq documentation](https://console.groq.com/docs) for more information.',
        controller_type: 'input',
        controller_props: {
          placeholder: 'https://api.groq.com/openai/v1',
          value: 'https://api.groq.com/openai/v1',
        },
      },
    ],
    models: [],
  },
  {
    active: true,
    api_key: '',
    base_url: 'https://generativelanguage.googleapis.com/v1beta/openai',
    explore_models_url: 'https://ai.google.dev/gemini-api/docs/models/gemini',
    provider: 'gemini',
    settings: [
      {
        key: 'api-key',
        title: 'API Key',
        description:
          "The Google API uses API keys for authentication. Visit your [API Keys](https://aistudio.google.com/apikey) page to retrieve the API key you'll use in your requests.",
        controller_type: 'input',
        controller_props: {
          placeholder: 'Insert API Key',
          value: '',
          type: 'password',
          input_actions: ['unobscure', 'copy'],
        },
      },
      {
        key: 'base-url',
        title: 'Base URL',
        description:
          'The base OpenAI-compatible endpoint to use. See the [Gemini documentation](https://ai.google.dev/gemini-api/docs/openai) for more information.',
        controller_type: 'input',
        controller_props: {
          placeholder:
            'https://generativelanguage.googleapis.com/v1beta/openai',
          value: 'https://generativelanguage.googleapis.com/v1beta/openai',
        },
      },
    ],
    models: [],
  },
  // {
  //   active: true,
  //   api_key: '',
  //   base_url: 'https://api.deepseek.com',
  //   explore_models_url: 'https://api-docs.deepseek.com/quick_start/pricing',
  //   provider: 'deepseek',
  //   settings: [
  //     {
  //       key: 'api-key',
  //       title: 'API Key',
  //       description:
  //         "The DeepSeek API uses API keys for authentication. Visit your [API Keys](https://platform.deepseek.com/api_keys) page to retrieve the API key you'll use in your requests.",
  //       controller_type: 'input',
  //       controller_props: {
  //         placeholder: 'Insert API Key',
  //         value: '',
  //         type: 'password',
  //         input_actions: ['unobscure', 'copy'],
  //       },
  //     },
  //     {
  //       key: 'base-url',
  //       title: 'Base URL',
  //       description:
  //         'The base endpoint to use. See the [DeepSeek documentation](https://api-docs.deepseek.com/) for more information.',
  //       controller_type: 'input',
  //       controller_props: {
  //         placeholder: 'https://api.deepseek.com',
  //         value: 'https://api.deepseek.com',
  //       },
  //     },
  //   ],
  //   models: [
  //     {
  //       id: 'deepseek-chat',
  //       name: 'DeepSeek-V3',
  //       version: '1.0',
  //       description:
  //         'The deepseek-chat model has been upgraded to DeepSeek-V3. deepseek-reasoner points to the new model DeepSeek-R1',
  //       capabilities: ['completion'],
  //     },
  //     {
  //       id: 'deepseek-reasoner',
  //       name: 'DeepSeek-R1',
  //       version: '1.0',
  //       description:
  //         'CoT (Chain of Thought) is the reasoning content deepseek-reasoner gives before output the final answer. For details, please refer to Reasoning Model.',
  //       capabilities: ['completion'],
  //     },
  //   ],
  // },
]

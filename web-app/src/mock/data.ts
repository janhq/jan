enum ContentType {
  Text = 'text',
  Image = 'image_url',
}

export const mockModelProvider = [
  {
    active: true,
    provider: 'llama.cpp',
    settings: [
      {
        key: 'cont_batching',
        title: 'Continuous Batching',
        description:
          'Allows processing prompts in parallel with text generation, which usually improves performance.',
        controller_type: 'checkbox',
        controller_props: {
          value: true,
        },
      },
      {
        key: 'n_parallel',
        title: 'Parallel Operations',
        description:
          'Number of prompts that can be processed simultaneously by the model.',
        controller_type: 'input',
        controller_props: {
          value: '4',
          placeholder: '4',
          type: 'number',
        },
      },
      {
        key: 'cpu_threads',
        title: 'CPU Threads',
        description:
          'Number of CPU cores used for model processing when running without GPU.',
        controller_type: 'input',
        controller_props: {
          value: '1',
          placeholder: '1',
          type: 'number',
        },
      },
      {
        key: 'flash_attn',
        title: 'Flash Attention',
        description:
          'Optimizes memory usage and speeds up model inference using an efficient attention implementation.',
        controller_type: 'checkbox',
        controller_props: {
          value: true,
        },
      },

      {
        key: 'caching_enabled',
        title: 'Caching',
        description:
          'Stores recent prompts and responses to improve speed when similar questions are asked.',
        controller_type: 'checkbox',
        controller_props: {
          value: true,
        },
      },
      {
        key: 'cache_type',
        title: 'KV Cache Type',
        description: 'Controls memory usage and precision trade-off.',
        controller_type: 'dropdown',
        controller_props: {
          value: 'f16',
          options: [
            {
              value: 'q4_0',
              name: 'q4_0',
            },
            {
              value: 'q8_0',
              name: 'q8_0',
            },
            {
              value: 'f16',
              name: 'f16',
            },
          ],
        },
      },
      {
        key: 'use_mmap',
        title: 'mmap',
        description:
          'Loads model files more efficiently by mapping them to memory, reducing RAM usage.',
        controller_type: 'checkbox',
        controller_props: {
          value: true,
        },
      },
    ],
    models: [
      {
        id: 'llama3.2:3b',
        model: 'llama3.2:3b',
        name: 'llama3.2:3b',
        capabilities: ['completion', 'tools'],
        version: 2,
        settings: {
          prompt_template:
            '<|begin_of_text|><|start_header_id|>system<|end_header_id|>\n\n{system_message}<|eot_id|><|start_header_id|>user<|end_header_id|>\n\n{prompt}<|eot_id|><|start_header_id|>assistant<|end_header_id|>\n\n',
          ctx_len: 4096,
          n_parallel: 1,
          cpu_threads: 1,
          ngl: 29,
        },
      },
      {
        id: 'deepseek-r1.2:3b',
        model: 'deepseek-r1.2:3b',
        name: 'deepseek-r1.2:3b',
        capabilities: ['completion', 'tools'],
        version: 2,
        settings: {
          prompt_template:
            '<|begin_of_text|><|start_header_id|>system<|end_header_id|>\n\n{system_message}<|eot_id|><|start_header_id|>user<|end_header_id|>\n\n{prompt}<|eot_id|><|start_header_id|>assistant<|end_header_id|>\n\n',
          ctx_len: 4096,
          n_parallel: 1,
          cpu_threads: 1,
          ngl: 29,
        },
      },
    ],
  },
  {
    active: false,
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
    models: [
      {
        id: 'gpt-4.5-preview',
        name: 'OpenAI GPT-4.5 Preview',
        version: '1.2',
        description:
          'OpenAI GPT 4.5 Preview is a research preview of GPT-4.5, our largest and most capable GPT model yet',
        format: 'api',
        capabilities: ['completion', 'tools'],
      },
      {
        id: 'gpt-4-turbo',
        name: 'OpenAI GPT-4 Turbo',
        version: '1.2',
        description: 'OpenAI GPT 4 Turbo model is extremely good',
        format: 'api',
        capabilities: ['completion', 'tools'],
      },
      {
        id: 'gpt-3.5-turbo',
        name: 'OpenAI GPT-3.5 Turbo',
        version: '1.1',
        description: 'OpenAI GPT 3.5 Turbo model is extremely fast',
        format: 'api',
        capabilities: ['completion'],
      },
      {
        id: 'gpt-4o',
        name: 'OpenAI GPT-4o',
        version: '1.1',
        description:
          'OpenAI GPT 4o is a new flagship model with fast speed and high quality',
        format: 'api',
        capabilities: ['completion', 'tools'],
      },
      {
        id: 'gpt-4o-mini',
        name: 'OpenAI GPT-4o mini',
        version: '1.1',
        description:
          'GPT-4o mini (“o” for “omni”) is a fast, affordable small model for focused tasks.',
        format: 'api',
        capabilities: ['completion', 'tools'],
      },
      {
        id: 'o1',
        name: 'OpenAI o1',
        version: '1.0',
        description: 'OpenAI o1 is a new model with complex reasoning',
        format: 'api',
        capabilities: ['completion', 'tools'],
      },
      {
        id: 'o1-preview',
        name: 'OpenAI o1-preview',
        version: '1.0',
        description: 'OpenAI o1-preview is a new model with complex reasoning',
        format: 'api',
        capabilities: ['completion', 'tools'],
      },
      {
        id: 'o1-mini',
        name: 'OpenAI o1-mini',
        version: '1.0',
        description: 'OpenAI o1-mini is a lightweight reasoning model',
        format: 'api',
        capabilities: ['completion'],
      },
      {
        id: 'o3-mini',
        name: 'OpenAI o3-mini',
        version: '1.0',
        description:
          'OpenAI most recent reasoning model, providing high intelligence at the same cost and latency targets of o1-mini.',
        format: 'api',
        capabilities: ['completion', 'tools'],
      },
    ],
  },
  {
    active: false,
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
    models: [
      {
        id: 'claude-3-opus-latest',
        name: 'Claude 3 Opus Latest',
        version: '1.0',
        description:
          'Claude 3 Opus is a powerful model suitables for highly complex task.',
        capabilities: ['completion', 'tools'],
      },
      {
        id: 'claude-3-5-haiku-latest',
        name: 'Claude 3.5 Haiku Latest',
        version: '1.0',
        description:
          'Claude 3.5 Haiku is the fastest model provides near-instant responsiveness.',
        capabilities: ['completion', 'tools'],
      },
      {
        id: 'claude-3-5-sonnet-latest',
        name: 'Claude 3.5 Sonnet Latest',
        version: '1.0',
        description:
          'Claude 3.5 Sonnet raises the industry bar for intelligence, outperforming competitor models and Claude 3 Opus on a wide range of evaluations, with the speed and cost of our mid-tier model, Claude 3 Sonnet.',
        capabilities: ['completion', 'tools'],
      },
      {
        id: 'claude-3-7-sonnet-latest',
        name: 'Claude 3.7 Sonnet Latest',
        version: '1.0',
        description:
          'Claude 3.7 Sonnet is the first hybrid reasoning model on the market. It is the most intelligent model yet. It is faster, more cost effective, and more capable than any other model in its class.',
        capabilities: ['completion', 'tools'],
      },
    ],
  },
  {
    active: false,
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
    models: [
      {
        id: 'command-r-plus',
        name: 'Command R+',
        version: '1.0',
        description:
          'Command R+ is an instruction-following conversational model that performs language tasks at a higher quality, more reliably, and with a longer context than previous models. It is best suited for complex RAG workflows and multi-step tool use.',
        capabilities: ['completion', 'tools'],
      },
      {
        id: 'command-r',
        name: 'Command R',
        version: '1.0',
        description:
          'Command R is an instruction-following conversational model that performs language tasks at a higher quality, more reliably, and with a longer context than previous models. It can be used for complex workflows like code generation, retrieval augmented generation (RAG), tool use, and agents.',
        capabilities: ['completion', 'tools'],
      },
    ],
  },
  {
    active: false,
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
    active: false,
    api_key: '',
    base_url: 'https://integrate.api.nvidia.com/v1',
    explore_models_url: 'https://build.nvidia.com/models',
    provider: 'nvidia',
    settings: [
      {
        key: 'api-key',
        title: 'API Key',
        description:
          "The NVIDIA API uses API keys for authentication. Visit your [API Keys](https://org.ngc.nvidia.com/setup/personal-keys) page to retrieve the API key you'll use in your requests.",
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
          'The base OpenAI-compatible endpoint to use. See the [NVIDIA NIM documentation](https://docs.api.nvidia.com/nim/reference/llm-apis) for more information.',
        controller_type: 'input',
        controller_props: {
          placeholder: 'https://integrate.api.nvidia.com/v1',
          value: 'https://integrate.api.nvidia.com/v1',
        },
      },
    ],
    models: [
      {
        id: 'mistralai/mistral-7b-instruct-v0.3',
        name: 'Mistral 7B Instruct v0.3',
        version: '1.1',
        description: 'Mistral 7B with NVIDIA',
        capabilities: ['completion'],
      },
    ],
  },
  {
    active: false,
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
    models: [
      {
        id: 'mistral-small-latest',
        name: 'Mistral Small',
        version: '1.1',
        description:
          'Mistral Small is the ideal choice for simple tasks (Classification, Customer Support, or Text Generation) at an affordable price.',
        capabilities: ['completion', 'tools'],
      },
      {
        id: 'mistral-large-latest',
        name: 'Mistral Large',
        version: '1.1',
        description:
          'Mistral Large is ideal for complex tasks (Synthetic Text Generation, Code Generation, RAG, or Agents).',
        capabilities: ['completion', 'tools'],
      },
      {
        id: 'open-mixtral-8x22b',
        name: 'Mixtral 8x22B',
        version: '1.1',
        description:
          'Mixtral 8x22B is a high-performance, cost-effective model designed for complex tasks.',
        capabilities: ['completion'],
      },
    ],
  },
  {
    active: false,
    api_key: '',
    base_url: 'https://withmartian.com/api/openai/v1',
    explore_models_url: 'https://withmartian.github.io/llm-adapters/',
    provider: 'martian',
    settings: [
      {
        key: 'api-key',
        title: 'API Key',
        description:
          "The Martian API uses API keys for authentication. Visit your [API Keys](https://withmartian.com/dashboard) page to retrieve the API key you'll use in your requests.",
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
          'The base OpenAI-compatible endpoint to use. See the [Groq documentation](https://withmartian.github.io/llm-adapters/) for more information.',
        controller_type: 'input',
        controller_props: {
          placeholder: 'https://withmartian.com/api/openai/v1',
          value: 'https://withmartian.com/api/openai/v1',
        },
      },
    ],
    models: [
      {
        id: 'router',
        name: 'Martian Model Router',
        version: '1.0',
        description:
          'Martian Model Router dynamically routes requests to the best LLM in real-time',
        capabilities: ['completion'],
      },
    ],
  },
  {
    active: false,
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
    models: [
      {
        id: 'llama-3.3-70b-versatile',
        name: 'Groq Llama-3.3-70B-Versatile',
        version: '1.1',
        description: 'Groq Llama 3 70b with supercharged speed!',
        capabilities: ['completion', 'tools'],
      },
      {
        id: 'llama-3.1-8b-instant',
        name: 'Groq Llama 3.1 8b Instant',
        version: '1.1',
        description: 'Groq Llama 3.1 8b with supercharged speed!',
        capabilities: ['completion', 'tools'],
      },
      {
        id: 'llama3-70b-8192',
        name: 'Groq Llama3-70B-8192',
        version: '1.1',
        description: 'Groq Llama 3 70b with supercharged speed!',
        capabilities: ['completion'],
      },
      {
        id: 'llama3-8b-8192',
        name: 'Groq Llama3-70B-8192',
        version: '1.1',
        description: 'Groq Llama 3 8b with supercharged speed!',
        capabilities: ['completion'],
      },
      {
        id: 'gemma2-9b-it',
        name: 'Groq Gemma 9B Instruct',
        version: '1.2',
        description: 'Groq Gemma 9b Instruct with supercharged speed!',
        capabilities: ['completion', 'tools'],
      },
    ],
  },
  {
    active: false,
    api_key: '',
    base_url: 'https://generativelanguage.googleapis.com/v1beta/openai',
    explore_models_url: 'https://ai.google.dev/gemini-api/docs/models/gemini',
    provider: 'google',
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
    models: [
      {
        id: 'gemini-2.5-pro-preview-03-25',
        name: 'Gemini 2.5 Pro Preview 03-25',
        version: '1.0',
        description: '',
        capabilities: ['completion', 'tools'],
      },
      {
        id: 'gemini-2.5-pro-exp-03-25',
        name: 'Gemini 2.5 Pro Experimental 03-25',
        version: '1.0',
        description: '',
        capabilities: ['completion', 'tools'],
      },
      {
        id: 'gemini-2.5-flash-preview-04-17',
        name: 'Gemini 2.5 Flash Preview 04-17',
        version: '1.0',
        description: '',
        capabilities: ['completion', 'tools'],
      },
      {
        id: 'gemini-2.0-flash',
        name: 'Gemini 2.0 Flash',
        version: '1.0',
        description:
          'A Gemini 2.0 Flash model optimized for cost efficiency and low latency.',
        capabilities: ['completion', 'tools'],
      },
      {
        id: 'gemini-2.0-flash-lite',
        name: 'Gemini 2.0 Flash-Lite',
        version: '1.0',
        description:
          'A Gemini 2.0 Flash model optimized for cost efficiency and low latency.',
        capabilities: ['completion'],
      },
      {
        id: 'gemini-1.5-pro',
        name: 'Gemini 1.5 Pro',
        version: '1.0',
        description:
          'Gemini 1.5 Pro is a mid-size multimodal model that is optimized for a wide-range of reasoning tasks. 1.5 Pro can process large amounts of data at once, including 2 hours of video, 19 hours of audio, codebases with 60,000 lines of code, or 2,000 pages of text. ',
        capabilities: ['completion', 'tools'],
      },
      {
        id: 'gemini-1.5-flash',
        name: 'Gemini 1.5 Flash',
        version: '1.0',
        description:
          'Gemini 1.5 Flash is a fast and versatile multimodal model for scaling across diverse tasks.',
        capabilities: ['completion', 'tools'],
      },
      {
        id: 'gemini-1.5-flash-8b',
        name: 'Gemini 1.5 Flash-8B',
        version: '1.0',
        description:
          'Gemini 1.5 Flash-8B is a small model designed for lower intelligence tasks.',
        capabilities: ['completion', 'tools'],
      },
    ],
  },
  {
    active: false,
    api_key: '',
    base_url: 'https://api.deepseek.com',
    explore_models_url: 'https://api-docs.deepseek.com/quick_start/pricing',
    provider: 'deepseek',
    settings: [
      {
        key: 'api-key',
        title: 'API Key',
        description:
          "The DeepSeek API uses API keys for authentication. Visit your [API Keys](https://platform.deepseek.com/api_keys) page to retrieve the API key you'll use in your requests.",
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
          'The base endpoint to use. See the [DeepSeek documentation](https://api-docs.deepseek.com/) for more information.',
        controller_type: 'input',
        controller_props: {
          placeholder: 'https://api.deepseek.com',
          value: 'https://api.deepseek.com',
        },
      },
    ],
    models: [
      {
        id: 'deepseek-chat',
        name: 'DeepSeek-V3',
        version: '1.0',
        description:
          'The deepseek-chat model has been upgraded to DeepSeek-V3. deepseek-reasoner points to the new model DeepSeek-R1',
        capabilities: ['completion'],
      },
      {
        id: 'deepseek-reasoner',
        name: 'DeepSeek-R1',
        version: '1.0',
        description:
          'CoT (Chain of Thought) is the reasoning content deepseek-reasoner gives before output the final answer. For details, please refer to Reasoning Model.',
        capabilities: ['completion'],
      },
    ],
  },
]

export const mockTheads = [
  {
    id: '1',
    title: 'Ultimate Markdown Demonstration',
    isFavorite: false,
    content: [
      {
        type: ContentType.Text,
        text: {
          value: 'Dow u know Ultimate Markdown Demonstration',
          annotations: [],
        },
      },
      {
        type: ContentType.Text,
        text: {
          value:
            '# :books: Ultimate Markdown Demonstration\n\nWelcome to the **Ultimate Markdown Demo**! This document covers a wide range of Markdown features.\n\n---\n\n## 1. Headings\n\n# H1\n## H2\n### H3\n#### H4\n##### H5\n###### H6\n\n---\n\n## 2. Text Formatting\n\n- **Bold**\n- *Italic*\n- ***Bold & Italic***\n- ~~Strikethrough~~\n\n> "Markdown is _awesome_!" — *Someone Famous*\n\n---\n\n## 3. Lists\n\n### 3.1. Unordered List\n\n- Item One\n  - Subitem A\n  - Subitem B\n    - Sub-Subitem i\n\n### 3.2. Ordered List\n\n1. First\n2. Second\n    1. Second-First\n    2. Second-Second\n3. Third\n\n---\n\n## 4. Links and Images\n\n- [Visit OpenAI](https://openai.com)\n- Inline Image:\n\n  ![Markdown Logo](https://markdown-here.com/img/icon256.png)\n\n- Linked Image:\n\n  [![Markdown Badge](https://img.shields.io/badge/Markdown-Ready-blue)](https://commonmark.org)\n\n---\n\n## 5. Code\n\n### 5.1. Inline Code\n\nUse the `print()` function in Python.\n\n### 5.2. Code Block\n\n```python\ndef greet(name):\n    return f"Hello, {name}!"\n\nprint(greet("Markdown"))\n```\n\n### 5.3. Syntax Highlighting (JavaScript)\n\n```javascript\nconst add = (a, b) => a + b;\nconsole.log(add(5, 3));\n```\n\n---\n\n## 6. Tables\n\n| Syntax | Description | Example |\n|--------|-------------|--------|\n| Header | Title       | Here\'s this |\n| Paragraph | Text | And more text |\n\n---\n\n## 7. Blockquotes\n\n> "A blockquote can be used to highlight information or quotes."\n\nNested Blockquote:\n\nLevel 1\n>Level 2\nLevel 3\n\n---\n\n## 8. Task Lists\n\n- [x] Write Markdown\n- [x] Check the output\n- [ ] Celebrate\n\n---\n\n## 9. Footnotes\n\nHere is a simple footnote[^1].\n\n[^1]: This is the footnote explanation.\n\n---\n\n## 10. Horizontal Rules\n\n---\n\n## 11. Emojis\n\n:tada: :sunglasses: :thumbsup: :potable_water: :book:\n\n---\n\n## 12. Math (Using LaTeX)\n\nInline math: \\( E = mc^2 \\)\n\nBlock math:\n\n$$\n\\int_0^\\infty e^{-x^2} dx = \\frac{\\sqrt{\\pi}}{2}\n$$\n\n---\n\n## 13. HTML in Markdown\n\nSometimes you need raw HTML:\n\n<div style="color:blue; font-weight:bold;">This is blue bold text using HTML inside Markdown!</div>\n\n---\n\n# :dart: That\'s a Wrap!\n\nCongratulations, you\'ve seen nearly every feature Markdown supports!',
          annotations: [],
        },
      },
    ],
    model: {
      id: 'gpt-4o',
      provider: 'openai',
    },
  },
  {
    id: '2',
    title: 'Modern JavaScript: A Comprehensive Guide',
    isFavorite: false,
    content: [
      {
        type: ContentType.Text,
        text: {
          value:
            "# 🚀 Modern JavaScript: A Comprehensive Guide\n\nThis guide covers essential concepts and features of modern JavaScript that every developer should know.\n\n## ES6+ Features\n\n### Arrow Functions\n\nArrow functions provide a concise syntax for writing functions and lexically bind the `this` value.\n\n```javascript\n// Traditional function\nfunction add(a, b) {\n  return a + b;\n}\n\n// Arrow function\nconst add = (a, b) => a + b;\n\n// With implicit return\nconst numbers = [1, 2, 3, 4];\nconst doubled = numbers.map(n => n * 2); // [2, 4, 6, 8]\n```\n\n### Destructuring\n\nDestructuring allows you to extract values from arrays or properties from objects into distinct variables.\n\n```javascript\n// Array destructuring\nconst [first, second, ...rest] = [1, 2, 3, 4, 5];\nconsole.log(first); // 1\nconsole.log(second); // 2\nconsole.log(rest); // [3, 4, 5]\n\n// Object destructuring\nconst person = { name: 'John', age: 30, city: 'New York' };\nconst { name, age, city: location } = person;\nconsole.log(name); // 'John'\nconsole.log(age); // 30\nconsole.log(location); // 'New York'\n```\n\n### Spread and Rest Operators\n\nThe spread operator (`...`) allows an iterable to be expanded in places where zero or more arguments or elements are expected.\n\n```javascript\n// Spread with arrays\nconst arr1 = [1, 2, 3];\nconst arr2 = [...arr1, 4, 5]; // [1, 2, 3, 4, 5]\n\n// Spread with objects\nconst obj1 = { a: 1, b: 2 };\nconst obj2 = { ...obj1, c: 3 }; // { a: 1, b: 2, c: 3 }\n\n// Rest parameter\nfunction sum(...numbers) {\n  return numbers.reduce((total, num) => total + num, 0);\n}\nconsole.log(sum(1, 2, 3, 4)); // 10\n```\n\n## Asynchronous JavaScript\n\n### Promises\n\nPromises represent the eventual completion (or failure) of an asynchronous operation and its resulting value.\n\n```javascript\nconst fetchData = () => {\n  return new Promise((resolve, reject) => {\n    // Simulating an API call\n    setTimeout(() => {\n      const data = { id: 1, name: 'User' };\n      if (data) {\n        resolve(data);\n      } else {\n        reject('Error fetching data');\n      }\n    }, 1000);\n  });\n};\n\nfetchData()\n  .then(data => console.log(data))\n  .catch(error => console.error(error));\n```\n\n### Async/Await\n\nAsync/await is syntactic sugar built on top of promises, making asynchronous code look and behave more like synchronous code.\n\n```javascript\nconst fetchUser = async (id) => {\n  try {\n    const response = await fetch(`https://api.example.com/users/${id}`);\n    if (!response.ok) throw new Error('Network response was not ok');\n    const user = await response.json();\n    return user;\n  } catch (error) {\n    console.error('Error fetching user:', error);\n    throw error;\n  }\n};\n\n// Using the async function\n(async () => {\n  try {\n    const user = await fetchUser(1);\n    console.log(user);\n  } catch (error) {\n    console.error(error);\n  }\n})();\n```\n\n## Modern JavaScript Patterns\n\n### Module Pattern\n\nES modules provide a way to organize and structure code in separate files.\n\n```javascript\n// math.js\nexport const add = (a, b) => a + b;\nexport const subtract = (a, b) => a - b;\n\n// main.js\nimport { add, subtract } from './math.js';\nconsole.log(add(5, 3)); // 8\n```\n\n### Optional Chaining\n\nOptional chaining (`?.`) allows reading the value of a property located deep within a chain of connected objects without having to check if each reference in the chain is valid.\n\n```javascript\nconst user = {\n  name: 'John',\n  address: {\n    street: '123 Main St',\n    city: 'New York'\n  }\n};\n\n// Without optional chaining\nconst city = user && user.address && user.address.city;\n\n// With optional chaining\nconst city = user?.address?.city;\n```\n\n## Conclusion\n\nModern JavaScript has evolved significantly with ES6+ features, making code more concise, readable, and maintainable. Understanding these concepts is essential for any JavaScript developer working on modern web applications.",
          annotations: [],
        },
      },
    ],
    model: {
      id: 'deepseek-r1:1.5b',
      provider: 'llama.cpp',
    },
  },
]

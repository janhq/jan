export const openAIProviderSettings = [
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
]
export const predefinedProviders = [
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
    base_url: 'https://YOUR-RESOURCE-NAME.openai.azure.com/openai/v1',
    explore_models_url: 'https://oai.azure.com/deployments',
    provider: 'azure',
    settings: [
      {
        key: 'api-key',
        title: 'API Key',
        description:
          'The Azure OpenAI API uses API keys for authentication. Visit your [Azure OpenAI Studio](https://oai.azure.com/) to retrieve the API key from your resource.',
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
          'Your Azure OpenAI resource endpoint. See the [Azure OpenAI documentation](https://learn.microsoft.com/en-us/azure/ai-foundry/openai/latest) for more information.',
        controller_type: 'input',
        controller_props: {
          placeholder: 'https://YOUR-RESOURCE-NAME.openai.azure.com/openai/v1',
          value: 'https://YOUR-RESOURCE-NAME.openai.azure.com/openai/v1',
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
          placeholder: 'https://api.anthropic.com',
          value: 'https://api.anthropic.com',
        },
      },
    ],
    models: [],
    custom_header: [
      {
        header: 'anthropic-version',
        value: '2023-06-01'
      },
      {
        header: 'anthropic-dangerous-direct-browser-access',
        value: 'true'
      }
    ]
  },
  {
    active: true,
    api_key: '',
    base_url: 'https://api.cohere.ai/v1',
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
    base_url: 'https://api.mistral.ai',
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
          placeholder: 'https://api.mistral.ai',
          value: 'https://api.mistral.ai',
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
  {
    active: true,
    api_key: '',
    base_url: 'https://router.huggingface.co/v1',
    explore_models_url:
      'https://huggingface.co/models?pipeline_tag=text-generation&inference_provider=all',
    provider: 'huggingface',
    settings: [
      {
        key: 'api-key',
        title: 'API Key',
        description:
          "The Hugging Face API uses tokens for authentication. Visit your [Access Tokens](https://huggingface.co/settings/tokens) page to retrieve the token you'll use in your requests.",
        controller_type: 'input',
        controller_props: {
          placeholder: 'Insert API Token',
          value: '',
          type: 'password',
          input_actions: ['unobscure', 'copy'],
        },
      },
      {
        key: 'base-url',
        title: 'Base URL',
        description:
          'The base endpoint to use. See the [Hugging Face Inference Providers documentation](https://huggingface.co/docs/inference-providers) for more information.',
        controller_type: 'input',
        controller_props: {
          placeholder: 'https://router.huggingface.co/v1',
          value: 'https://router.huggingface.co/v1',
        },
      },
    ],
    models: [
      {
        id: 'moonshotai/Kimi-K2-Instruct:groq',
        name: 'Kimi-K2-Instruct',
        version: '1.0',
        description:
          '1T parameters Moonshot chat model tuned for tool-aware, nuanced responses.',
        capabilities: ['completion', 'tools'],
      },
      {
        id: 'deepseek-ai/DeepSeek-R1-0528',
        name: 'DeepSeek-R1-0528',
        version: '1.0',
        description:
          "DeepSeek's flagship reasoning engine with open weights and advanced tool control.",
        capabilities: ['completion', 'tools'],
      },
      {
        id: 'deepseek-ai/DeepSeek-V3-0324',
        name: 'DeepSeek-V3-0324',
        version: '1.0',
        description:
          'Streamlined DeepSeek model focused on fast, high-quality completions and tool use.',
        capabilities: ['completion', 'tools'],
      },
    ],
  },
  {
    active: true,
    api_key: '',
    base_url: 'https://api.cometapi.com/v1',
    explore_models_url: 'https://api.cometapi.com/pricing',
    provider: 'cometapi',
    settings: [
      {
        key: 'api-key',
        title: 'API Key',
        description:
          "The CometAPI uses API keys for authentication. Visit your [API Keys](https://api.cometapi.com/console/token) page to retrieve the API key you'll use in your requests.",
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
          'The base endpoint to use. See the [CometAPI API documentation](https://api.cometapi.com/doc) for more information.',
        controller_type: 'input',
        controller_props: {
          placeholder: 'https://api.cometapi.com/v1',
          value: 'https://api.cometapi.com/v1',
        },
      },
    ],
    models: [
      // GPT series
      {
        id: 'gpt-5-chat-latest',
        name: 'GPT-5 Chat Latest',
        version: '1.0',
        description: '',
        capabilities: ['completion'],
      },
      {
        id: 'gpt-5-mini',
        name: 'GPT-5 Mini',
        version: '1.0',
        description: '',
        capabilities: ['completion'],
      },
      {
        id: 'gpt-5-nano',
        name: 'GPT-5 Nano',
        version: '1.0',
        description: '',
        capabilities: ['completion'],
      },
      {
        id: 'gpt-5',
        name: 'GPT-5',
        version: '1.0',
        description: '',
        capabilities: ['completion'],
      },
      {
        id: 'gpt-4.1',
        name: 'GPT-4.1',
        version: '1.0',
        description: '',
        capabilities: ['completion'],
      },
      {
        id: 'gpt-4o-mini',
        name: 'GPT-4o Mini',
        version: '1.0',
        description: '',
        capabilities: ['completion'],
      },
      {
        id: 'o4-mini-2025-04-16',
        name: 'o4-mini (2025-04-16)',
        version: '1.0',
        description: '',
        capabilities: ['completion'],
      },
      {
        id: 'o3-pro-2025-06-10',
        name: 'o3-pro (2025-06-10)',
        version: '1.0',
        description: '',
        capabilities: ['completion'],
      },
      // Claude series
      {
        id: 'claude-opus-4-1-20250805',
        name: 'Claude Opus 4.1 (2025-08-05)',
        version: '1.0',
        description: '',
        capabilities: ['completion'],
      },
      {
        id: 'claude-opus-4-1-20250805-thinking',
        name: 'Claude Opus 4.1 Thinking (2025-08-05)',
        version: '1.0',
        description: '',
        capabilities: ['completion'],
      },
      {
        id: 'claude-sonnet-4-20250514',
        name: 'Claude Sonnet 4 (2025-05-14)',
        version: '1.0',
        description: '',
        capabilities: ['completion'],
      },
      {
        id: 'claude-sonnet-4-20250514-thinking',
        name: 'Claude Sonnet 4 Thinking (2025-05-14)',
        version: '1.0',
        description: '',
        capabilities: ['completion'],
      },
      {
        id: 'claude-3-7-sonnet-latest',
        name: 'Claude 3.7 Sonnet Latest',
        version: '1.0',
        description: '',
        capabilities: ['completion'],
      },
      {
        id: 'claude-3-5-haiku-latest',
        name: 'Claude 3.5 Haiku Latest',
        version: '1.0',
        description: '',
        capabilities: ['completion'],
      },
      // Gemini series
      {
        id: 'gemini-2.5-pro',
        name: 'Gemini 2.5 Pro',
        version: '1.0',
        description: '',
        capabilities: ['completion'],
      },
      {
        id: 'gemini-2.5-flash',
        name: 'Gemini 2.5 Flash',
        version: '1.0',
        description: '',
        capabilities: ['completion'],
      },
      {
        id: 'gemini-2.5-flash-lite',
        name: 'Gemini 2.5 Flash Lite',
        version: '1.0',
        description: '',
        capabilities: ['completion'],
      },
      {
        id: 'gemini-2.0-flash',
        name: 'Gemini 2.0 Flash',
        version: '1.0',
        description: '',
        capabilities: ['completion'],
      },
      // Grok series
      {
        id: 'grok-4',
        name: 'Grok 4',
        version: '1.0',
        description: '',
        capabilities: ['completion'],
      },
      {
        id: 'grok-4-fast-non-reasoning',
        name: 'Grok 4 Fast Non-Reasoning',
        version: '1.0',
        description: '',
        capabilities: ['completion'],
      },
      {
        id: 'grok-4-fast-reasoning',
        name: 'Grok 4 Fast Reasoning',
        version: '1.0',
        description: '',
        capabilities: ['completion'],
      },
      // DeepSeek series
      {
        id: 'deepseek-v3.1',
        name: 'DeepSeek V3.1',
        version: '1.0',
        description: '',
        capabilities: ['completion'],
      },
      {
        id: 'deepseek-chat',
        name: 'DeepSeek Chat',
        version: '1.0',
        description: '',
        capabilities: ['completion'],
      },
      {
        id: 'deepseek-reasoner',
        name: 'DeepSeek Reasoner',
        version: '1.0',
        description: '',
        capabilities: ['completion'],
      },
      // Qwen series
      {
        id: 'qwen3-30b-a3b',
        name: 'Qwen3 30B A3B',
        version: '1.0',
        description: '',
        capabilities: ['completion'],
      },
      {
        id: 'qwen3-coder-plus-2025-07-22',
        name: 'Qwen3 Coder Plus (2025-07-22)',
        version: '1.0',
        description: '',
        capabilities: ['completion'],
      },
    ],
  },
]

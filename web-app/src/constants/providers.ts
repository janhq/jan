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
  {
    active: true,
    api_key: '',
    base_url: 'https://api.avian.io/v1',
    explore_models_url: 'https://avian.io/models',
    provider: 'avian',
    settings: [
      {
        key: 'api-key',
        title: 'API Key',
        description:
          "The Avian API uses API keys for authentication. Visit your [Dashboard](https://avian.io/dashboard) to retrieve the API key you'll use in your requests.",
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
          'The base OpenAI-compatible endpoint to use. See the [Avian API documentation](https://avian.io/docs) for more information.',
        controller_type: 'input',
        controller_props: {
          placeholder: 'https://api.avian.io/v1',
          value: 'https://api.avian.io/v1',
        },
      },
    ],
    models: [
      {
        id: 'deepseek/deepseek-v3.2',
        name: 'DeepSeek V3.2',
        version: '1.0',
        description:
          'DeepSeek V3.2 with 164K context. Fast, cost-effective completions with tool calling support.',
        capabilities: ['completion', 'tools'],
      },
      {
        id: 'moonshotai/kimi-k2.5',
        name: 'Kimi K2.5',
        version: '1.0',
        description:
          'Moonshot Kimi K2.5 with 131K context. Advanced reasoning and tool-aware responses.',
        capabilities: ['completion', 'tools'],
      },
      {
        id: 'z-ai/glm-5',
        name: 'GLM-5',
        version: '1.0',
        description:
          'Zhipu GLM-5 with 131K context. Multilingual chat model with strong coding abilities.',
        capabilities: ['completion', 'tools'],
      },
      {
        id: 'minimax/minimax-m2.5',
        name: 'MiniMax M2.5',
        version: '1.0',
        description:
          'MiniMax M2.5 with 1M context window. Extended context for long document analysis.',
        capabilities: ['completion', 'tools'],
      },
    ],
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
]

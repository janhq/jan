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
    base_url: 'https://api.anthropic.com',
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
    base_url: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',
    explore_models_url: 'https://www.alibabacloud.com/help/en/model-studio/models',
    provider: 'qwen',
    settings: [
      {
        key: 'api-key',
        title: 'API Key',
        description:
          "The Alibaba Qwen API uses API keys for authentication. Visit your [API Keys](https://dashscope.console.aliyun.com/apiKey) page to retrieve the API key you'll use in your requests.",
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
          'The base OpenAI-compatible endpoint to use. See the [Qwen documentation](https://www.alibabacloud.com/help/en/model-studio/use-qwen-by-calling-api) for more information.',
        controller_type: 'input',
        controller_props: {
          placeholder: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',
          value: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',
        },
      },
    ],
    models: [],
  },
  {
    active: true,
    api_key: '',
    base_url: 'https://api.deepseek.com/v1',
    explore_models_url: 'https://platform.deepseek.com/api-docs',
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
          'The base OpenAI-compatible endpoint to use. See the [DeepSeek documentation](https://platform.deepseek.com/api-docs) for more information.',
        controller_type: 'input',
        controller_props: {
          placeholder: 'https://api.deepseek.com/v1',
          value: 'https://api.deepseek.com/v1',
        },
      },
    ],
    models: [],
  },
  {
    active: true,
    api_key: '',
    base_url: 'https://api.together.xyz/v1',
    explore_models_url: 'https://docs.together.ai/docs/inference-models',
    provider: 'together',
    settings: [
      {
        key: 'api-key',
        title: 'API Key',
        description:
          "The Together AI API uses API keys for authentication. Visit your [API Keys](https://api.together.ai/settings/api-keys) page to retrieve the API key you'll use in your requests.",
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
          'The base OpenAI-compatible endpoint to use. See the [Together AI documentation](https://docs.together.ai/docs/inference-models) for more information.',
        controller_type: 'input',
        controller_props: {
          placeholder: 'https://api.together.xyz/v1',
          value: 'https://api.together.xyz/v1',
        },
      },
    ],
    models: [],
  },
  {
    active: true,
    api_key: '',
    base_url: 'https://api.inflection.ai/v1',
    explore_models_url: 'https://inflection.ai/',
    provider: 'inflection',
    settings: [
      {
        key: 'api-key',
        title: 'API Key',
        description:
          "The Inflection AI API uses API keys for authentication. Visit your [API Keys](https://inflection.ai/) page to retrieve the API key you'll use in your requests.",
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
          'The base OpenAI-compatible endpoint to use. See the [Inflection AI documentation](https://inflection.ai/) for more information.',
        controller_type: 'input',
        controller_props: {
          placeholder: 'https://api.inflection.ai/v1',
          value: 'https://api.inflection.ai/v1',
        },
      },
    ],
    models: [],
  },
  {
    active: true,
    api_key: '',
    base_url: 'https://open.bigmodel.cn/api/paas/v4/openai',
    explore_models_url: 'https://open.bigmodel.cn/',
    provider: 'zhipu',
    settings: [
      {
        key: 'api-key',
        title: 'API Key',
        description:
          "The Zhipu AI API uses API keys for authentication. Visit your [API Keys](https://open.bigmodel.cn/usercenter/apikeys) page to retrieve the API key you'll use in your requests.",
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
          'The base OpenAI-compatible endpoint to use. See the [Zhipu AI documentation](https://open.bigmodel.cn/) for more information.',
        controller_type: 'input',
        controller_props: {
          placeholder: 'https://open.bigmodel.cn/api/paas/v4/openai',
          value: 'https://open.bigmodel.cn/api/paas/v4/openai',
        },
      },
    ],
    models: [],
  },
  {
    active: true,
    api_key: '',
    base_url: 'https://aip.baidubce.com/rpc/2.0/ai_custom/v1/wenxinworkshop/chat',
    explore_models_url: 'https://cloud.baidu.com/product/wenxinworkshop',
    provider: 'baidu',
    settings: [
      {
        key: 'api-key',
        title: 'API Key',
        description:
          "The Baidu API uses API keys for authentication. Visit your [API Keys](https://console.bce.baidu.com/qianfan/ais/console/applicationConsole/application) page to retrieve the API key you'll use in your requests.",
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
          'The base endpoint to use. See the [Baidu documentation](https://cloud.baidu.com/doc/WENXINWORKSHOP/s/Ilkkrb0i5) for more information.',
        controller_type: 'input',
        controller_props: {
          placeholder: 'https://aip.baidubce.com/rpc/2.0/ai_custom/v1/wenxinworkshop/chat',
          value: 'https://aip.baidubce.com/rpc/2.0/ai_custom/v1/wenxinworkshop/chat',
        },
      },
    ],
    models: [],
  },
  {
    active: true,
    api_key: '',
    base_url: 'https://api.x.ai/v1',
    explore_models_url: 'https://x.ai/',
    provider: 'xai',
    settings: [
      {
        key: 'api-key',
        title: 'API Key',
        description:
          "The xAI API uses API keys for authentication. Visit your [API Keys](https://x.ai/) page to retrieve the API key you'll use in your requests.",
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
          'The base OpenAI-compatible endpoint to use. See the [xAI documentation](https://x.ai/) for more information.',
        controller_type: 'input',
        controller_props: {
          placeholder: 'https://api.x.ai/v1',
          value: 'https://api.x.ai/v1',
        },
      },
    ],
    models: [],
  },
  {
    active: true,
    api_key: '',
    base_url: 'https://api.stability.ai/v1',
    explore_models_url: 'https://platform.stability.ai/',
    provider: 'stability',
    settings: [
      {
        key: 'api-key',
        title: 'API Key',
        description:
          "The Stability AI API uses API keys for authentication. Visit your [API Keys](https://platform.stability.ai/account/keys) page to retrieve the API key you'll use in your requests.",
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
          'The base endpoint to use. See the [Stability AI documentation](https://platform.stability.ai/docs) for more information.',
        controller_type: 'input',
        controller_props: {
          placeholder: 'https://api.stability.ai/v1',
          value: 'https://api.stability.ai/v1',
        },
      },
    ],
    models: [],
  },
  {
    active: true,
    api_key: '',
    base_url: 'https://api.ai21.com/studio/v1',
    explore_models_url: 'https://docs.ai21.com/reference/j2-complete-api-ref',
    provider: 'ai21',
    settings: [
      {
        key: 'api-key',
        title: 'API Key',
        description:
          "The AI21 Labs API uses API keys for authentication. Visit your [API Keys](https://studio.ai21.com/account/api-keys) page to retrieve the API key you'll use in your requests.",
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
          'The base OpenAI-compatible endpoint to use. See the [AI21 Labs documentation](https://docs.ai21.com/reference/j2-complete-api-ref) for more information.',
        controller_type: 'input',
        controller_props: {
          placeholder: 'https://api.ai21.com/studio/v1',
          value: 'https://api.ai21.com/studio/v1',
        },
      },
    ],
    models: [],
  },
  {
    active: true,
    api_key: '',
    base_url: 'https://api.aleph-alpha.com/v1',
    explore_models_url: 'https://docs.aleph-alpha.com/',
    provider: 'aleph-alpha',
    settings: [
      {
        key: 'api-key',
        title: 'API Key',
        description:
          "The Aleph Alpha API uses API keys for authentication. Visit your [API Keys](https://app.aleph-alpha.com/) page to retrieve the API key you'll use in your requests.",
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
          'The base OpenAI-compatible endpoint to use. See the [Aleph Alpha documentation](https://docs.aleph-alpha.com/) for more information.',
        controller_type: 'input',
        controller_props: {
          placeholder: 'https://api.aleph-alpha.com/v1',
          value: 'https://api.aleph-alpha.com/v1',
        },
      },
    ],
    models: [],
  },
  {
    active: true,
    api_key: '',
    base_url: 'https://api.mosaicml.com/v1',
    explore_models_url: 'https://docs.mosaicml.com/en/latest/inference.html',
    provider: 'mosaicml',
    settings: [
      {
        key: 'api-key',
        title: 'API Key',
        description:
          "The MosaicML API uses API keys for authentication. Visit your [API Keys](https://cloud.mosaicml.com/) page to retrieve the API key you'll use in your requests.",
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
          'The base OpenAI-compatible endpoint to use. See the [MosaicML documentation](https://docs.mosaicml.com/en/latest/inference.html) for more information.',
        controller_type: 'input',
        controller_props: {
          placeholder: 'https://api.mosaicml.com/v1',
          value: 'https://api.mosaicml.com/v1',
        },
      },
    ],
    models: [],
  },
  {
    active: true,
    api_key: '',
    base_url: 'https://api.lighton.ai/v1',
    explore_models_url: 'https://lighton.ai/',
    provider: 'lighton',
    settings: [
      {
        key: 'api-key',
        title: 'API Key',
        description:
          "The LightOn API uses API keys for authentication. Visit your [API Keys](https://lighton.ai/) page to retrieve the API key you'll use in your requests.",
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
          'The base OpenAI-compatible endpoint to use. See the [LightOn documentation](https://lighton.ai/) for more information.',
        controller_type: 'input',
        controller_props: {
          placeholder: 'https://api.lighton.ai/v1',
          value: 'https://api.lighton.ai/v1',
        },
      },
    ],
    models: [],
  },
  {
    active: true,
    api_key: '',
    base_url: 'https://api.reka.ai/v1',
    explore_models_url: 'https://reka.ai/',
    provider: 'reka',
    settings: [
      {
        key: 'api-key',
        title: 'API Key',
        description:
          "The Reka AI API uses API keys for authentication. Visit your [API Keys](https://reka.ai/) page to retrieve the API key you'll use in your requests.",
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
          'The base OpenAI-compatible endpoint to use. See the [Reka AI documentation](https://reka.ai/) for more information.',
        controller_type: 'input',
        controller_props: {
          placeholder: 'https://api.reka.ai/v1',
          value: 'https://api.reka.ai/v1',
        },
      },
    ],
    models: [],
  },
]

/**
 * Bundled baseline of provider definitions.
 *
 * Most cloud providers (OpenAI, Anthropic, OpenRouter, Mistral, Groq, xAI,
 * Gemini, MiniMax, Hugging Face, NVIDIA, ...) are no longer hard-coded here.
 * They are loaded at runtime from the `atomic-chat-conf` registry — see
 * `web-app/src/services/provider-registry.ts` and the
 * `web-app/src/services/AGENTS.md` feature notes.
 *
 * This file keeps a minimal in-app baseline used as:
 *   1. A bootstrap value before the first registry refresh resolves.
 *   2. A permanent fallback when the network or registry is unavailable.
 *   3. The shape used to build a custom provider via `Settings > Providers`
 *      ({@link openAIProviderSettings}).
 *
 * Add a provider here ONLY if it cannot live in the remote registry
 * (e.g. it requires per-user resource configuration like Azure OpenAI).
 * Do NOT re-introduce providers that already exist in
 * `atomic-chat-conf/providers/registry.json`.
 */

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

/**
 * In-app baseline of providers that cannot (or should not) live in the remote
 * registry. The registry-store seeds itself from this list on first load.
 */
export const BASELINE_PROVIDERS = [
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
] as const

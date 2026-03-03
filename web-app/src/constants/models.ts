/**
 * Model-related constants
 */

export const NEW_JAN_MODEL_HF_REPO = 'janhq/Jan-v3-4B-base-instruct-GGUF'
export const DEFAULT_MODEL_QUANTIZATIONS = ['iq4_xs', 'q4_k_m']

/**
 * Quantizations to check for SetupScreen quick start
 * Includes Q8 for higher quality on capable systems
 */
export const SETUP_SCREEN_QUANTIZATIONS = ['q4_k_xl']

export const JAN_V2_VL_MODEL_HF_REPO = 'janhq/Jan-v2-VL-high-gguf'
export const JAN_V2_VL_QUANTIZATIONS = ['q4_k_m', 'q4_k_s', 'q4_0', 'q3_k_m']

/**
 * Provider model capabilities - copied from token.js package
 */
export const providerModels = {
  openai: {
    models: ['gpt-5', 'gpt-5-mini', 'gpt-4.5-preview', 'gpt-4.1', 'gpt-4o', 'gpt-4o-mini', 'o3-mini', 'gpt-4-turbo'],
    supportsCompletion: true,
    supportsStreaming: ['gpt-5', 'gpt-5-mini', 'gpt-4.5-preview', 'gpt-4.1', 'gpt-4o', 'gpt-4o-mini', 'o3-mini', 'gpt-4-turbo'],
    supportsJSON: ['gpt-5', 'gpt-5-mini', 'gpt-4.5-preview', 'gpt-4.1', 'gpt-4o', 'gpt-4o-mini', 'o3-mini', 'gpt-4-turbo'],
    supportsImages: ['gpt-5', 'gpt-5-mini', 'gpt-4.5-preview', 'gpt-4.1', 'gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo'],
    supportsToolCalls: ['gpt-5', 'gpt-5-mini', 'gpt-4.5-preview', 'gpt-4.1', 'gpt-4o', 'gpt-4o-mini', 'o3-mini', 'gpt-4-turbo'],
    supportsN: true,
  },
  ai21: {
    models: ['jamba-instruct'],
    supportsCompletion: true,
    supportsStreaming: ['jamba-instruct'],
    supportsJSON: [],
    supportsImages: [],
    supportsToolCalls: [],
    supportsN: true,
  },
  anthropic: {
    models: ['claude-sonnet-4-5', 'claude-haiku-4-5', 'claude-opus-4-1', 'claude-sonnet-4', 'claude-opus-4', 'claude-3-7-sonnet-20250219', 'claude-3-5-haiku-20241022', 'claude-3-haiku-20240307'],
    supportsCompletion: true,
    supportsStreaming: ['claude-sonnet-4-5', 'claude-haiku-4-5', 'claude-opus-4-1', 'claude-sonnet-4', 'claude-opus-4', 'claude-3-7-sonnet-20250219', 'claude-3-5-haiku-20241022', 'claude-3-haiku-20240307'],
    supportsJSON: [],
    supportsImages: ['claude-sonnet-4-5', 'claude-haiku-4-5', 'claude-opus-4-1', 'claude-sonnet-4', 'claude-opus-4', 'claude-3-7-sonnet-20250219', 'claude-3-5-haiku-20241022', 'claude-3-haiku-20240307'],
    supportsToolCalls: ['claude-sonnet-4-5', 'claude-haiku-4-5', 'claude-opus-4-1', 'claude-sonnet-4', 'claude-opus-4', 'claude-3-7-sonnet-20250219', 'claude-3-5-haiku-20241022', 'claude-3-haiku-20240307'],
    supportsN: true,
  },
  gemini: {
    models: ['gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-2.0-flash', 'gemini-2.0-flash-lite', 'gemini-1.5-flash', 'gemini-1.5-flash-8b'],
    supportsCompletion: true,
    supportsStreaming: ['gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-2.0-flash', 'gemini-2.0-flash-lite', 'gemini-1.5-flash', 'gemini-1.5-flash-8b'],
    supportsJSON: ['gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-2.0-flash', 'gemini-2.0-flash-lite', 'gemini-1.5-flash', 'gemini-1.5-flash-8b'],
    supportsImages: ['gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-2.0-flash', 'gemini-2.0-flash-lite', 'gemini-1.5-flash', 'gemini-1.5-flash-8b'],
    supportsToolCalls: ['gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-2.0-flash', 'gemini-2.0-flash-lite', 'gemini-1.5-flash', 'gemini-1.5-flash-8b'],
    supportsN: true,
  },
  cohere: {
    models: ['command-a-03-2025', 'command-r-08-2024', 'command-r-plus-08-2024'],
    supportsCompletion: true,
    supportsStreaming: ['command-a-03-2025', 'command-r-08-2024', 'command-r-plus-08-2024'],
    supportsJSON: [],
    supportsImages: [],
    supportsToolCalls: ['command-a-03-2025', 'command-r-08-2024', 'command-r-plus-08-2024'],
    supportsN: true,
  },
  bedrock: {
    models: ['anthropic.claude-3-5-sonnet-20241022-v2:0', 'anthropic.claude-3-5-haiku-20241022-v1:0', 'cohere.command-r-plus-v1:0', 'cohere.command-r-v1:0', 'meta.llama3-70b-instruct-v1:0', 'meta.llama3-8b-instruct-v1:0', 'mistral.mistral-large-2402-v1:0', 'amazon.titan-text-express-v1'],
    supportsCompletion: true,
    supportsStreaming: ['anthropic.claude-3-5-sonnet-20241022-v2:0', 'anthropic.claude-3-5-haiku-20241022-v1:0', 'cohere.command-r-plus-v1:0', 'cohere.command-r-v1:0', 'meta.llama3-70b-instruct-v1:0', 'meta.llama3-8b-instruct-v1:0', 'mistral.mistral-large-2402-v1:0', 'amazon.titan-text-express-v1'],
    supportsJSON: [],
    supportsImages: ['anthropic.claude-3-5-sonnet-20241022-v2:0', 'anthropic.claude-3-5-haiku-20241022-v1:0'],
    supportsToolCalls: ['anthropic.claude-3-5-sonnet-20241022-v2:0', 'anthropic.claude-3-5-haiku-20241022-v1:0', 'cohere.command-r-plus-v1:0', 'cohere.command-r-v1:0', 'mistral.mistral-large-2402-v1:0'],
    supportsN: true,
  },
  mistral: {
    models: ['mistral-large-2411', 'magistral-medium-2509', 'magistral-small-2509', 'pixtral-large-2411', 'pixtral-12b-2409', 'codestral-2508', 'mistral-small-2506', 'mistral-nemo-2407'],
    supportsCompletion: true,
    supportsStreaming: ['mistral-large-2411', 'magistral-medium-2509', 'magistral-small-2509', 'pixtral-large-2411', 'pixtral-12b-2409', 'codestral-2508', 'mistral-small-2506', 'mistral-nemo-2407'],
    supportsJSON: ['mistral-large-2411', 'codestral-2508'],
    supportsImages: ['magistral-medium-2509', 'magistral-small-2509', 'pixtral-large-2411', 'pixtral-12b-2409', 'mistral-small-2506'],
    supportsToolCalls: ['mistral-large-2411', 'mistral-small-2506'],
    supportsN: true,
  },
  groq: {
    models: ['meta-llama/llama-4-maverick-17b-128e-instruct', 'meta-llama/llama-4-scout-17b-16e-instruct', 'llama-3.3-70b-versatile', 'llama-3.1-8b-instant', 'moonshotai/kimi-k2-instruct-0905', 'qwen/qwen3-32b', 'openai/gpt-oss-120b', 'whisper-large-v3-turbo'],
    supportsCompletion: true,
    supportsStreaming: ['meta-llama/llama-4-maverick-17b-128e-instruct', 'meta-llama/llama-4-scout-17b-16e-instruct', 'llama-3.3-70b-versatile', 'llama-3.1-8b-instant', 'moonshotai/kimi-k2-instruct-0905', 'qwen/qwen3-32b', 'openai/gpt-oss-120b'],
    supportsJSON: ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant', 'openai/gpt-oss-120b'],
    supportsImages: ['meta-llama/llama-4-maverick-17b-128e-instruct', 'meta-llama/llama-4-scout-17b-16e-instruct'],
    supportsToolCalls: [],
    supportsN: true,
  },
  xai: {
    models: ['grok-4-1-fast-reasoning', 'grok-4-fast-reasoning', 'grok-3', 'grok-3-mini', 'grok-2-vision-1212', 'grok-imagine-image'],
    supportsCompletion: true,
    supportsStreaming: ['grok-4-1-fast-reasoning', 'grok-4-fast-reasoning', 'grok-3', 'grok-3-mini', 'grok-2-vision-1212'],
    supportsJSON: ['grok-4-1-fast-reasoning', 'grok-4-fast-reasoning', 'grok-3', 'grok-3-mini'],
    supportsImages: ['grok-2-vision-1212'],
    supportsToolCalls: ['grok-4-1-fast-reasoning', 'grok-4-fast-reasoning', 'grok-3', 'grok-3-mini'],
    supportsN: true,
  },
  perplexity: {
    models: ['sonar', 'sonar-pro', 'sonar-reasoning-pro'],
    supportsCompletion: true,
    supportsStreaming: ['sonar', 'sonar-pro', 'sonar-reasoning-pro'],
    supportsJSON: ['sonar', 'sonar-pro', 'sonar-reasoning-pro'],
    supportsImages: [],
    supportsToolCalls: ['sonar', 'sonar-pro', 'sonar-reasoning-pro'],
    supportsN: true,
  },
  openrouter: {
    models: true,
    supportsCompletion: true,
    supportsStreaming: true,
    supportsJSON: true,
    supportsImages: true,
    supportsToolCalls: true,
    supportsN: true,
  },
  'openai-compatible': {
    models: true,
    supportsCompletion: true,
    supportsStreaming: true,
    supportsJSON: true,
    supportsImages: true,
    supportsToolCalls: true,
    supportsN: true,
  },
} as const
/**
 * Model-related constants
 */

import type { CatalogModel } from '@/services/models/types'
import type { Recommendation } from '@/services/recommended-models-registry'

export const EMBEDDING_MODEL_ID = 'sentence-transformer-mini'

export const NEW_JAN_MODEL_HF_REPO =
  'Jackrong/Qwen3.5-4B-Claude-4.6-Opus-Reasoning-Distilled-GGUF'
export const JAN_CODE_HF_REPO = 'janhq/Jan-Code-4b-Gguf'
export const DEFAULT_MODEL_QUANTIZATIONS = ['iq4_xs', 'q4_k_m']

/**
 * Quantizations to check for SetupScreen quick start
 * Includes Q8 for higher quality on capable systems
 */
export const SETUP_SCREEN_QUANTIZATIONS = ['q4_k_m']

/**
 * Bundled fallback for the recommended-models registry. Mirrors the contents
 * of `atomic-chat-conf/models/recommended.json` so the client can render the
 * Recommended section on the very first launch (before the manifest fetch
 * resolves) and when the network is unavailable.
 *
 * Platform filtering happens at runtime in
 * `recommended-models-registry-store.ts` — keep `platforms` declarative here
 * (do NOT inline `IS_MACOS` ternaries) so the baseline mirrors the manifest
 * shape verbatim.
 */
export const BASELINE_RECOMMENDED_MODELS: ReadonlyArray<Recommendation> = [
  {
    model_name: 'unsloth/gemma-4-E4B-it-GGUF',
    description_key: 'hub:recEverydayUse',
  },
  {
    model_name: 'unsloth/Qwen3.5-9B-GGUF',
    description_key: 'hub:recVisionKnowledge',
  },
  {
    model_name: 'mlx-community/gemma-4-e4b-it-4bit',
    description_key: 'hub:recForMlx',
    platforms: ['macos'],
  },
  {
    model_name: 'mlx-community/Qwen3.5-9B-MLX-4bit',
    description_key: 'hub:recForMlx',
    platforms: ['macos'],
  },
  {
    model_name: 'unsloth/Llama-3.2-3B-Instruct-GGUF',
    description_key: 'hub:recFinetuningChat',
    platforms: ['windows', 'linux'],
  },
]

const GEMMA4_HF =
  'https://huggingface.co/unsloth/gemma-4-E4B-it-GGUF/resolve/main'
const QWEN_MLX_HF =
  'https://huggingface.co/mlx-community/Qwen3.5-9B-MLX-4bit/resolve/main'

//! MLX-fallback инжектится только на macOS — иначе утекает через useState-инициализацию
//! useResolvedRecommendedModels и через прямое чтение в routes/hub/$modelId.tsx
const MLX_QWEN_FALLBACK: CatalogModel = {
  model_name: 'mlx-community/Qwen3.5-9B-MLX-4bit',
  developer: 'mlx-community',
  library_name: 'mlx',
  description:
    '**Tags**: Image-Text-to-Text, MLX, Safetensors, qwen3_5, vision-language-model, 4-bit, conversational',
  downloads: 73490,
  num_safetensors: 1,
  safetensors_files: [
    {
      model_id: 'mlx-community/Qwen3.5-9B-MLX-4bit',
      path: `${QWEN_MLX_HF}/model.safetensors`,
      file_size: '5.6 GB',
    },
  ],
  is_mlx: true,
  readme: `${QWEN_MLX_HF.replace('/resolve/main', '')}/resolve/main/README.md`,
}

export const RECOMMENDED_MODEL_FALLBACKS: Readonly<
  Record<string, CatalogModel>
> = {
  'unsloth/gemma-4-E4B-it-GGUF': {
    model_name: 'unsloth/gemma-4-E4B-it-GGUF',
    developer: 'unsloth',
    description:
      '**Tags**: Image-Text-to-Text, GGUF, gemma4, unsloth, gemma, google, conversational',
    downloads: 0,
    num_quants: 22,
    quants: [
      {
        model_id: 'unsloth/gemma-4-E4B-it-BF16',
        path: `${GEMMA4_HF}/gemma-4-E4B-it-BF16.gguf`,
        file_size: '15.1 GB',
      },
      {
        model_id: 'unsloth/gemma-4-E4B-it-Q8_0',
        path: `${GEMMA4_HF}/gemma-4-E4B-it-Q8_0.gguf`,
        file_size: '8.2 GB',
      },
      {
        model_id: 'unsloth/gemma-4-E4B-it-Q6_K',
        path: `${GEMMA4_HF}/gemma-4-E4B-it-Q6_K.gguf`,
        file_size: '7.1 GB',
      },
      {
        model_id: 'unsloth/gemma-4-E4B-it-Q5_K_M',
        path: `${GEMMA4_HF}/gemma-4-E4B-it-Q5_K_M.gguf`,
        file_size: '5.5 GB',
      },
      {
        model_id: 'unsloth/gemma-4-E4B-it-Q5_K_S',
        path: `${GEMMA4_HF}/gemma-4-E4B-it-Q5_K_S.gguf`,
        file_size: '5.4 GB',
      },
      {
        model_id: 'unsloth/gemma-4-E4B-it-Q4_1',
        path: `${GEMMA4_HF}/gemma-4-E4B-it-Q4_1.gguf`,
        file_size: '5.1 GB',
      },
      {
        model_id: 'unsloth/gemma-4-E4B-it-Q4_K_M',
        path: `${GEMMA4_HF}/gemma-4-E4B-it-Q4_K_M.gguf`,
        file_size: '5.0 GB',
      },
      {
        model_id: 'unsloth/gemma-4-E4B-it-IQ4_NL',
        path: `${GEMMA4_HF}/gemma-4-E4B-it-IQ4_NL.gguf`,
        file_size: '4.8 GB',
      },
      {
        model_id: 'unsloth/gemma-4-E4B-it-Q4_K_S',
        path: `${GEMMA4_HF}/gemma-4-E4B-it-Q4_K_S.gguf`,
        file_size: '4.8 GB',
      },
      {
        model_id: 'unsloth/gemma-4-E4B-it-Q4_0',
        path: `${GEMMA4_HF}/gemma-4-E4B-it-Q4_0.gguf`,
        file_size: '4.8 GB',
      },
      {
        model_id: 'unsloth/gemma-4-E4B-it-IQ4_XS',
        path: `${GEMMA4_HF}/gemma-4-E4B-it-IQ4_XS.gguf`,
        file_size: '4.7 GB',
      },
      {
        model_id: 'unsloth/gemma-4-E4B-it-Q3_K_M',
        path: `${GEMMA4_HF}/gemma-4-E4B-it-Q3_K_M.gguf`,
        file_size: '4.1 GB',
      },
      {
        model_id: 'unsloth/gemma-4-E4B-it-Q3_K_S',
        path: `${GEMMA4_HF}/gemma-4-E4B-it-Q3_K_S.gguf`,
        file_size: '3.9 GB',
      },
      {
        model_id: 'unsloth/gemma-4-E4B-it-UD-Q8_K_XL',
        path: `${GEMMA4_HF}/gemma-4-E4B-it-UD-Q8_K_XL.gguf`,
        file_size: '8.7 GB',
      },
      {
        model_id: 'unsloth/gemma-4-E4B-it-UD-Q6_K_XL',
        path: `${GEMMA4_HF}/gemma-4-E4B-it-UD-Q6_K_XL.gguf`,
        file_size: '7.5 GB',
      },
      {
        model_id: 'unsloth/gemma-4-E4B-it-UD-Q5_K_XL',
        path: `${GEMMA4_HF}/gemma-4-E4B-it-UD-Q5_K_XL.gguf`,
        file_size: '6.7 GB',
      },
      {
        model_id: 'unsloth/gemma-4-E4B-it-UD-Q4_K_XL',
        path: `${GEMMA4_HF}/gemma-4-E4B-it-UD-Q4_K_XL.gguf`,
        file_size: '5.1 GB',
      },
      {
        model_id: 'unsloth/gemma-4-E4B-it-UD-Q3_K_XL',
        path: `${GEMMA4_HF}/gemma-4-E4B-it-UD-Q3_K_XL.gguf`,
        file_size: '4.6 GB',
      },
      {
        model_id: 'unsloth/gemma-4-E4B-it-UD-Q2_K_XL',
        path: `${GEMMA4_HF}/gemma-4-E4B-it-UD-Q2_K_XL.gguf`,
        file_size: '3.7 GB',
      },
      {
        model_id: 'unsloth/gemma-4-E4B-it-UD-IQ3_XXS',
        path: `${GEMMA4_HF}/gemma-4-E4B-it-UD-IQ3_XXS.gguf`,
        file_size: '3.7 GB',
      },
      {
        model_id: 'unsloth/gemma-4-E4B-it-UD-IQ2_M',
        path: `${GEMMA4_HF}/gemma-4-E4B-it-UD-IQ2_M.gguf`,
        file_size: '3.5 GB',
      },
      {
        model_id: 'unsloth/gemma-4-E4B-it-UD-IQ2_XXS',
        path: `${GEMMA4_HF}/gemma-4-E4B-it-UD-IQ2_XXS.gguf`,
        file_size: '3.3 GB',
      },
    ],
    num_mmproj: 3,
    mmproj_models: [
      {
        model_id: 'mmproj-F16',
        path: `${GEMMA4_HF}/mmproj-F16.gguf`,
        file_size: '990.0 MB',
      },
      {
        model_id: 'mmproj-BF16',
        path: `${GEMMA4_HF}/mmproj-BF16.gguf`,
        file_size: '992.0 MB',
      },
      {
        model_id: 'mmproj-F32',
        path: `${GEMMA4_HF}/mmproj-F32.gguf`,
        file_size: '1.9 GB',
      },
    ],
    readme: `${GEMMA4_HF.replace('/resolve/main', '')}/resolve/main/README.md`,
  },
  ...(IS_MACOS
    ? { 'mlx-community/Qwen3.5-9B-MLX-4bit': MLX_QWEN_FALLBACK }
    : {}),
}

export const JAN_V2_VL_MODEL_HF_REPO = 'janhq/Jan-v2-VL-high-gguf'
export const JAN_V2_VL_QUANTIZATIONS = ['q4_k_m', 'q4_k_s', 'q4_0', 'q3_k_m']

/**
 * Provider model capabilities - copied from token.js package
 */
export const providerModels = {
  // OpenAI — set verified against the live /v1/models response on macOS build (Apr 2026).
  // o3-mini is reasoning-only (text), so it is excluded from supportsImages.
  'openai': {
    models: [
      'gpt-5.4',
      'gpt-5.4-mini',
      'gpt-5.4-nano',
      'gpt-5',
      'gpt-5-mini',
      'gpt-4.5-preview',
      'gpt-4.1',
      'gpt-4o',
      'gpt-4o-mini',
      'o3-mini',
      'gpt-4-turbo',
    ],
    supportsCompletion: true,
    supportsStreaming: [
      'gpt-5.4',
      'gpt-5.4-mini',
      'gpt-5.4-nano',
      'gpt-5',
      'gpt-5-mini',
      'gpt-4.5-preview',
      'gpt-4.1',
      'gpt-4o',
      'gpt-4o-mini',
      'o3-mini',
      'gpt-4-turbo',
    ],
    supportsJSON: [
      'gpt-5.4',
      'gpt-5.4-mini',
      'gpt-5.4-nano',
      'gpt-5',
      'gpt-5-mini',
      'gpt-4.5-preview',
      'gpt-4.1',
      'gpt-4o',
      'gpt-4o-mini',
      'o3-mini',
      'gpt-4-turbo',
    ],
    supportsImages: [
      'gpt-5.4',
      'gpt-5.4-mini',
      'gpt-5.4-nano',
      'gpt-5',
      'gpt-5-mini',
      'gpt-4.5-preview',
      'gpt-4.1',
      'gpt-4o',
      'gpt-4o-mini',
      'gpt-4-turbo',
    ],
    supportsToolCalls: [
      'gpt-5.4',
      'gpt-5.4-mini',
      'gpt-5.4-nano',
      'gpt-5',
      'gpt-5-mini',
      'gpt-4.5-preview',
      'gpt-4.1',
      'gpt-4o',
      'gpt-4o-mini',
      'o3-mini',
      'gpt-4-turbo',
    ],
    supportsN: true,
  },
  'ai21': {
    models: ['jamba-instruct'],
    supportsCompletion: true,
    supportsStreaming: ['jamba-instruct'],
    supportsJSON: [],
    supportsImages: [],
    supportsToolCalls: [],
    supportsN: true,
  },
  // Anthropic — source: https://platform.claude.com/docs/en/about-claude/models/overview (Apr 21, 2026)
  // Only current/active models. claude-sonnet-4 & claude-opus-4 deprecated (retire 15 Jun 2026).
  // claude-3-* models retired.
  'anthropic': {
    models: [
      'claude-opus-4-7',
      'claude-sonnet-4-6',
      'claude-haiku-4-5',
      'claude-opus-4-6',
      'claude-opus-4-5',
      'claude-opus-4-1',
      'claude-sonnet-4-5',
    ],
    supportsCompletion: true,
    supportsStreaming: [
      'claude-opus-4-7',
      'claude-sonnet-4-6',
      'claude-haiku-4-5',
      'claude-opus-4-6',
      'claude-opus-4-5',
      'claude-opus-4-1',
      'claude-sonnet-4-5',
    ],
    supportsJSON: [],
    supportsImages: [
      'claude-opus-4-7',
      'claude-sonnet-4-6',
      'claude-haiku-4-5',
      'claude-opus-4-6',
      'claude-opus-4-5',
      'claude-opus-4-1',
      'claude-sonnet-4-5',
    ],
    supportsToolCalls: [
      'claude-opus-4-7',
      'claude-sonnet-4-6',
      'claude-haiku-4-5',
      'claude-opus-4-6',
      'claude-opus-4-5',
      'claude-opus-4-1',
      'claude-sonnet-4-5',
    ],
    supportsN: true,
  },
  // Gemini — source: https://ai.google.dev/gemini-api/docs/models (Apr 2026)
  // 3.x line is preview; 2.5.x stable. 2.0-* scheduled for shutdown 1 Jun 2026; 1.5-* retired.
  'gemini': {
    models: [
      'gemini-3.1-pro-preview',
      'gemini-3-flash-preview',
      'gemini-3.1-flash-lite-preview',
      'gemini-2.5-pro',
      'gemini-2.5-flash',
      'gemini-2.5-flash-lite',
    ],
    supportsCompletion: true,
    supportsStreaming: [
      'gemini-3.1-pro-preview',
      'gemini-3-flash-preview',
      'gemini-3.1-flash-lite-preview',
      'gemini-2.5-pro',
      'gemini-2.5-flash',
      'gemini-2.5-flash-lite',
    ],
    supportsJSON: [
      'gemini-3.1-pro-preview',
      'gemini-3-flash-preview',
      'gemini-3.1-flash-lite-preview',
      'gemini-2.5-pro',
      'gemini-2.5-flash',
      'gemini-2.5-flash-lite',
    ],
    supportsImages: [
      'gemini-3.1-pro-preview',
      'gemini-3-flash-preview',
      'gemini-3.1-flash-lite-preview',
      'gemini-2.5-pro',
      'gemini-2.5-flash',
      'gemini-2.5-flash-lite',
    ],
    supportsToolCalls: [
      'gemini-3.1-pro-preview',
      'gemini-3-flash-preview',
      'gemini-3.1-flash-lite-preview',
      'gemini-2.5-pro',
      'gemini-2.5-flash',
      'gemini-2.5-flash-lite',
    ],
    supportsN: true,
  },
  'cohere': {
    models: [
      'command-a-03-2025',
      'command-r-08-2024',
      'command-r-plus-08-2024',
    ],
    supportsCompletion: true,
    supportsStreaming: [
      'command-a-03-2025',
      'command-r-08-2024',
      'command-r-plus-08-2024',
    ],
    supportsJSON: [],
    supportsImages: [],
    supportsToolCalls: [
      'command-a-03-2025',
      'command-r-08-2024',
      'command-r-plus-08-2024',
    ],
    supportsN: true,
  },
  'bedrock': {
    models: [
      'anthropic.claude-3-5-sonnet-20241022-v2:0',
      'anthropic.claude-3-5-haiku-20241022-v1:0',
      'cohere.command-r-plus-v1:0',
      'cohere.command-r-v1:0',
      'meta.llama3-70b-instruct-v1:0',
      'meta.llama3-8b-instruct-v1:0',
      'mistral.mistral-large-2402-v1:0',
      'amazon.titan-text-express-v1',
    ],
    supportsCompletion: true,
    supportsStreaming: [
      'anthropic.claude-3-5-sonnet-20241022-v2:0',
      'anthropic.claude-3-5-haiku-20241022-v1:0',
      'cohere.command-r-plus-v1:0',
      'cohere.command-r-v1:0',
      'meta.llama3-70b-instruct-v1:0',
      'meta.llama3-8b-instruct-v1:0',
      'mistral.mistral-large-2402-v1:0',
      'amazon.titan-text-express-v1',
    ],
    supportsJSON: [],
    supportsImages: [
      'anthropic.claude-3-5-sonnet-20241022-v2:0',
      'anthropic.claude-3-5-haiku-20241022-v1:0',
    ],
    supportsToolCalls: [
      'anthropic.claude-3-5-sonnet-20241022-v2:0',
      'anthropic.claude-3-5-haiku-20241022-v1:0',
      'cohere.command-r-plus-v1:0',
      'cohere.command-r-v1:0',
      'mistral.mistral-large-2402-v1:0',
    ],
    supportsN: true,
  },
  'mistral': {
    models: [
      'mistral-large-2411',
      'magistral-medium-2509',
      'magistral-small-2509',
      'pixtral-large-2411',
      'pixtral-12b-2409',
      'codestral-2508',
      'mistral-small-2506',
      'mistral-nemo-2407',
    ],
    supportsCompletion: true,
    supportsStreaming: [
      'mistral-large-2411',
      'magistral-medium-2509',
      'magistral-small-2509',
      'pixtral-large-2411',
      'pixtral-12b-2409',
      'codestral-2508',
      'mistral-small-2506',
      'mistral-nemo-2407',
    ],
    supportsJSON: ['mistral-large-2411', 'codestral-2508'],
    supportsImages: [
      'magistral-medium-2509',
      'magistral-small-2509',
      'pixtral-large-2411',
      'pixtral-12b-2409',
      'mistral-small-2506',
    ],
    supportsToolCalls: ['mistral-large-2411', 'mistral-small-2506'],
    supportsN: true,
  },
  'groq': {
    models: [
      'meta-llama/llama-4-maverick-17b-128e-instruct',
      'meta-llama/llama-4-scout-17b-16e-instruct',
      'llama-3.3-70b-versatile',
      'llama-3.1-8b-instant',
      'moonshotai/kimi-k2-instruct-0905',
      'qwen/qwen3-32b',
      'openai/gpt-oss-120b',
      'whisper-large-v3-turbo',
    ],
    supportsCompletion: true,
    supportsStreaming: [
      'meta-llama/llama-4-maverick-17b-128e-instruct',
      'meta-llama/llama-4-scout-17b-16e-instruct',
      'llama-3.3-70b-versatile',
      'llama-3.1-8b-instant',
      'moonshotai/kimi-k2-instruct-0905',
      'qwen/qwen3-32b',
      'openai/gpt-oss-120b',
    ],
    supportsJSON: [
      'llama-3.3-70b-versatile',
      'llama-3.1-8b-instant',
      'openai/gpt-oss-120b',
    ],
    supportsImages: [
      'meta-llama/llama-4-maverick-17b-128e-instruct',
      'meta-llama/llama-4-scout-17b-16e-instruct',
    ],
    supportsToolCalls: [],
    supportsN: true,
  },
  // xAI — source: https://docs.x.ai/developers/models (Apr 2026)
  // grok-4.20 is flagship; 4-1-fast is cost-efficient; code-fast specialized.
  // grok-3/grok-2-vision kept as legacy for thread back-compat.
  'xai': {
    models: [
      'grok-4.20-0309-reasoning',
      'grok-4.20-0309-non-reasoning',
      'grok-4-1-fast-reasoning',
      'grok-4-1-fast-non-reasoning',
      'grok-code-fast-1',
      'grok-3',
      'grok-3-mini',
      'grok-2-vision-1212',
    ],
    supportsCompletion: true,
    supportsStreaming: [
      'grok-4.20-0309-reasoning',
      'grok-4.20-0309-non-reasoning',
      'grok-4-1-fast-reasoning',
      'grok-4-1-fast-non-reasoning',
      'grok-code-fast-1',
      'grok-3',
      'grok-3-mini',
      'grok-2-vision-1212',
    ],
    supportsJSON: [
      'grok-4.20-0309-reasoning',
      'grok-4.20-0309-non-reasoning',
      'grok-4-1-fast-reasoning',
      'grok-4-1-fast-non-reasoning',
      'grok-code-fast-1',
      'grok-3',
      'grok-3-mini',
    ],
    supportsImages: [
      'grok-4.20-0309-reasoning',
      'grok-4.20-0309-non-reasoning',
      'grok-4-1-fast-reasoning',
      'grok-4-1-fast-non-reasoning',
      'grok-2-vision-1212',
    ],
    supportsToolCalls: [
      'grok-4.20-0309-reasoning',
      'grok-4.20-0309-non-reasoning',
      'grok-4-1-fast-reasoning',
      'grok-4-1-fast-non-reasoning',
      'grok-code-fast-1',
      'grok-3',
      'grok-3-mini',
    ],
    supportsN: true,
  },
  'perplexity': {
    models: ['sonar', 'sonar-pro', 'sonar-reasoning-pro'],
    supportsCompletion: true,
    supportsStreaming: ['sonar', 'sonar-pro', 'sonar-reasoning-pro'],
    supportsJSON: ['sonar', 'sonar-pro', 'sonar-reasoning-pro'],
    supportsImages: [],
    supportsToolCalls: ['sonar', 'sonar-pro', 'sonar-reasoning-pro'],
    supportsN: true,
  },
  'minimax': {
    models: [
      'MiniMax-M2.7',
      'MiniMax-M2.7-highspeed',
      'MiniMax-M2.5',
      'MiniMax-M2.5-highspeed',
    ],
    supportsCompletion: true,
    supportsStreaming: [
      'MiniMax-M2.7',
      'MiniMax-M2.7-highspeed',
      'MiniMax-M2.5',
      'MiniMax-M2.5-highspeed',
    ],
    supportsJSON: [],
    supportsImages: [],
    supportsToolCalls: [
      'MiniMax-M2.7',
      'MiniMax-M2.7-highspeed',
      'MiniMax-M2.5',
      'MiniMax-M2.5-highspeed',
    ],
    supportsN: true,
  },
  'openrouter': {
    models: true,
    supportsCompletion: true,
    supportsStreaming: true,
    supportsJSON: true,
    supportsImages: true,
    supportsToolCalls: true,
    supportsN: true,
  },
  'nvidia': {
    models: ['moonshotai/kimi-k2.5', 'minimaxai/minimax-m2.5', 'z-ai/glm5'],
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

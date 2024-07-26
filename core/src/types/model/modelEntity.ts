import { Model as OpenAiModel } from 'openai/resources'

export const LocalEngines = ['cortex.llamacpp', 'cortex.onnx', 'cortex.tensorrt-llm'] as const

export const RemoteEngines = [
  'anthropic',
  'mistral',
  'martian',
  'openrouter',
  'openai',
  'groq',
  'triton_trtllm',
  'cohere',
] as const

export const LlmEngines = [...LocalEngines, ...RemoteEngines] as const
export type LlmEngine = (typeof LlmEngines)[number]
export type LocalEngine = (typeof LocalEngines)[number]
export type RemoteEngine = (typeof RemoteEngines)[number]

export type ModelArtifact = {
  filename: string
  url: string
}

export interface Model extends OpenAiModel, ModelSettingParams, ModelRuntimeParams {
  /**
   * Model identifier.
   */
  model: string

  /**
   * GGUF metadata: general.name
   */
  name?: string

  /**
   * GGUF metadata: version
   */
  version?: string

  /**
   * Currently we only have 'embedding' | 'llm'
   */
  model_type?: string

  /**
   * The model download source. It can be an external url or a local filepath.
   */
  files: string[] | ModelArtifact

  metadata?: Record<string, any>
}

/**
 * The available model settings.
 */
export interface ModelSettingParams {
  /**
   * The context length for model operations varies; the maximum depends on the specific model used.
   */
  ctx_len?: number

  /**
   * The number of layers to load onto the GPU for acceleration.
   */
  ngl?: number
  embedding?: boolean

  /**
   * Number of parallel sequences to decode
   */
  n_parallel?: number

  /**
   * Determines CPU inference threads, limited by hardware and OS. (Maximum determined by system)
   */
  cpu_threads?: number

  /**
   * GGUF metadata: tokenizer.chat_template
   */
  prompt_template?: string
  system_prompt?: string
  ai_prompt?: string
  user_prompt?: string
  llama_model_path?: string
  mmproj?: string
  cont_batching?: boolean

  /**
   * The model engine.
   */
  engine?: LlmEngine

  /**
   * The prompt to use for internal configuration
   */
  pre_prompt?: string

  /**
   * The batch size for prompt eval step
   */
  n_batch?: number

  /**
   * To enable prompt caching or not
   */
  caching_enabled?: boolean

  /**
   * Group attention factor in self-extend
   */
  grp_attn_n?: number

  /**
   * Group attention width in self-extend
   */
  grp_attn_w?: number

  /**
   * Prevent system swapping of the model to disk in macOS
   */
  mlock?: boolean

  /**
   * You can constrain the sampling using GBNF grammars by providing path to a grammar file
   */
  grammar_file?: string

  /**
   * To enable Flash Attention, default is true
   */
  flash_attn?: boolean

  /**
   * KV cache type: f16, q8_0, q4_0, default is f16
   */
  cache_type?: string

  /**
   * To enable mmap, default is true
   */
  use_mmap?: boolean
}
type ModelSettingParamsKeys = keyof ModelSettingParams
export const modelSettingParamsKeys: ModelSettingParamsKeys[] = [
  'ctx_len',
  'ngl',
  'embedding',
  'n_parallel',
  'cpu_threads',
  'prompt_template',
  'system_prompt',
  'ai_prompt',
  'user_prompt',
  'llama_model_path',
  'mmproj',
  'cont_batching',
  'engine',
  'pre_prompt',
  'n_batch',
  'caching_enabled',
  'grp_attn_n',
  'grp_attn_w',
  'mlock',
  'grammar_file',
  'flash_attn',
  'cache_type',
  'use_mmap',
]

/**
 * The available model runtime parameters.
 */
export interface ModelRuntimeParams {
  /**
   * Controls the randomness of the model’s output.
   */
  temperature?: number
  token_limit?: number
  top_k?: number

  /**
   * Set probability threshold for more relevant outputs.
   */
  top_p?: number

  /**
   * Enable real-time data processing for faster predictions.
   */
  stream?: boolean

  /*
   * The maximum number of tokens the model will generate in a single response.
   */
  max_tokens?: number

  /**
   * Defines specific tokens or phrases at which the model will stop generating further output.
   */
  stop?: string[]

  /**
   * Adjusts the likelihood of the model repeating words or phrases in its output.
   */
  frequency_penalty?: number

  /**
   * Influences the generation of new and varied concepts in the model’s output.
   */
  presence_penalty?: number
}
type ModelRuntimeParamsKeys = keyof ModelRuntimeParams
export const modelRuntimeParamsKeys: ModelRuntimeParamsKeys[] = [
  'temperature',
  'token_limit',
  'top_k',
  'top_p',
  'stream',
  'max_tokens',
  'stop',
  'frequency_penalty',
  'presence_penalty',
]

/**
 * Represents the information about a model.
 * @stored
 */
export type ModelInfo = {
  id: string
  settings?: ModelSettingParams
  parameters?: ModelRuntimeParams
  engine?: string
}

// Represents an artifact of a model, including its filename and URL
export type ModelArtifact = {
  filename: string
  url: string
}

/**
 * Model type defines the shape of a model object.
 * @stored
 */
export type Model = {
  /**
   * The type of the object.
   * Default: "model"
   */
  object: string

  /**
   * The version of the model.
   */
  version: string

  /**
   * The format of the model.
   */
  format: string

  /**
   * The model download source. It can be an external url or a local filepath.
   */
  sources: ModelArtifact[]

  /**
   * The model identifier, which can be referenced in the API endpoints.
   */
  id: string

  /**
   * The model identifier, modern version of id.
   */
  model?: string

  /**
   * Human-readable name that is used for UI.
   */
  name: string

  /**
   * The Unix timestamp (in seconds) for when the model was created
   */
  created: number

  /**
   * Default: "A cool model from Huggingface"
   */
  description: string

  /**
   * The model settings.
   */
  settings: ModelSettingParams

  /**
   * The model runtime parameters.
   */
  parameters: ModelRuntimeParams

  /**
   * Metadata of the model.
   */
  metadata: ModelMetadata
  /**
   * The model engine.
   */
  engine: string
}

// Represents metadata associated with a model
export type ModelMetadata = {
  author: string
  tags: string[]
  size: number
  cover?: string
  // These settings to preserve model settings across threads
  default_ctx_len?: number
  default_max_tokens?: number
}

/**
 * The available model settings.
 */
export type ModelSettingParams = {
  ctx_len?: number
  ngl?: number
  embedding?: boolean
  n_parallel?: number
  cpu_threads?: number
  prompt_template?: string
  pre_prompt?: string
  system_prompt?: string
  ai_prompt?: string
  user_prompt?: string
  // path param
  model_path?: string
  // legacy path param
  llama_model_path?: string
  // clip model path
  mmproj?: string
  cont_batching?: boolean
  vision_model?: boolean
  text_model?: boolean
  engine?: boolean
  top_p?: number
  top_k?: number
  min_p?: number
  temperature?: number
  repeat_penalty?: number
  repeat_last_n?: number
  presence_penalty?: number
  frequency_penalty?: number
}

/**
 * The available model runtime parameters.
 */
export type ModelRuntimeParams = {
  temperature?: number
  max_temperature?: number
  token_limit?: number
  top_k?: number
  top_p?: number
  stream?: boolean
  max_tokens?: number
  stop?: string[]
  frequency_penalty?: number
  presence_penalty?: number
  engine?: string
}

// Represents a model that failed to initialize, including the error
export type ModelInitFailed = Model & {
  error: Error
}

/**
 * ModelParams types
 */
export type ModelParams = ModelRuntimeParams | ModelSettingParams

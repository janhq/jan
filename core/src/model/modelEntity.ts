/**
 * Model type defines the shape of a model object.
 * @stored
 */
export interface Model {
  /**
   * The type of the object.
   * Default: "model"
   */
  object: string

  /**
   * The version of the model.
   */
  version: number

  /**
   * The format of the model.
   */
  format: string

  /**
   * The model download source. It can be an external url or a local filepath.
   */
  source_url: string

  /**
   * The model identifier, which can be referenced in the API endpoints.
   */
  id: string

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
   * The model state.
   * Default: "to_download"
   * Enum: "to_download" "downloading" "ready" "running"
   */
  state?: ModelState

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
  engine: InferenceEngine
}

// TODO(@hiro): refactor this duplicated code
/**
 * Represents the information about a model.
 * @stored
 */
export interface ModelInfo {
  id: string
  settings: ModelSettingParams
  parameters: ModelRuntimeParams
  engine?: InferenceEngine
}

export interface ModelMetadata {
  author: string
  tags: string[]
  size: number
  cover?: string
}

/**
 * The Model transition states.
 */
export enum ModelState {
  Downloading = 'downloading',
  Ready = 'ready',
  Running = 'running',
}

/**
 * The available model settings.
 */
export interface ModelSettingParams {
  ctx_len?: number
  ngl?: number
  embedding?: boolean
  n_parallel?: number
  system_prompt?: string
  user_prompt?: string
  ai_prompt?: string
}

/**
 * The available model runtime parameters.
 */
export interface ModelRuntimeParams {
  temperature?: number
  token_limit?: number
  top_k?: number
  top_p?: number
  stream?: boolean
  max_tokens?: number
}

/**
 * Represents the inference engine.
 * @stored
 */
export enum InferenceEngine {
  nitro = 'nitro',
  openai = 'openai',
  nvidia_triton = 'nvidia_triton',
  hf_endpoint = 'hf_endpoint',
}

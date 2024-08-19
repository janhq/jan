/**
 * Model settings params
 * used in model load request
 */
export const modelSettingParams: string[] = [
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
/**
 * Inference settings eparams
 * used in inference request
 */
export const inferenceParams: string[] = [
  'ctx_len',
  'ngl',
  'embedding',
  'n_parallel',
  'cpu_threads',
  'prompt_template',
  'llama_model_path',
  'mmproj',
  'vision_model',
  'text_model',
]

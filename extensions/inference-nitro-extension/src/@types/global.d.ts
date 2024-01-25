declare const NODE: string;
declare const INFERENCE_URL: string;
declare const TROUBLESHOOTING_URL: string;

/**
 * The parameters for the initModel function.
 * @property settings - The settings for the machine learning model.
 * @property settings.ctx_len - The context length.
 * @property settings.ngl - The number of generated tokens.
 * @property settings.cont_batching - Whether to use continuous batching.
 * @property settings.embedding - Whether to use embedding.
 */
interface EngineSettings {
  ctx_len: number;
  ngl: number;
  cpu_threads: number;
  cont_batching: boolean;
  embedding: boolean;
}
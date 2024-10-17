declare const NODE: string
declare const CORTEX_API_URL: string
declare const DEFAULT_SETTINGS: Array<any>
declare const MODELS: Array<any>

/**
 * The response from the initModel function.
 * @property error - An error message if the model fails to load.
 */
interface ModelOperationResponse {
  error?: any
  modelFile?: string
}

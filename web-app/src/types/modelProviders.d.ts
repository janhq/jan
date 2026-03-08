/**
 * The controller props for settings
 */
type ControllerProps = {
  value?: string | boolean | number
  placeholder?: string
  type?: string
  options?: Array<{ value: number | string; name: string }>
  input_actions?: string[]
  recommended?: string
}

/**
 * The setting item for a provider
 */
type ProviderSetting = {
  key: string
  title: string
  description: string
  controller_type: 'input' | 'checkbox' | 'dropdown' | 'slider' | string
  controller_props: ControllerProps
}

/**
 * The model object structure
 */
type Model = {
  id: string
  model?: string
  name?: string
  displayName?: string
  version?: number | string
  description?: string
  format?: string
  capabilities?: string[]
  settings?: Record<string, ProviderSetting>
  /** Whether this model is an embedding model (e.g., BERT-based) */
  embedding?: boolean
}

/**
 * The provider object structure
 */
type ProviderObject = {
  active: boolean
  provider: string
  explore_models_url?: string
  api_key?: string
  base_url?: string
  settings: ProviderSetting[]
  models: Model[]
  persist?: boolean
  custom_header?: ProviderCustomHeader[] | null
}

/**
 * The model provider type
 */
type ModelProvider = ProviderObject

/**
 * Proxy configuration options
 * @description This type defines the structure of the proxy configuration options.
 */
type ProxyOptions = {
  proxyEnabled: boolean
  proxyUrl: string
  proxyUsername: string
  proxyPassword: string
  proxyIgnoreSSL: boolean
  verifyProxySSL: boolean
  verifyProxyHostSSL: boolean
  verifyPeerSSL: boolean
  verifyHostSSL: boolean
  noProxy: string
}

type ProviderCustomHeader = {
  header: string
  value: string
}
/**
 * GGUF Metadata of the model source
 */
export interface GGUF {
  architecture: string
  bos_token: string
  chat_template: string
  context_length: number
  eos_token: string
  total: number
}

/**
 * Card Metadata of the model source
 */
export interface CardData {
  license: string
  pipeline_tag: string
}

/**
 * Model Metadata of the model source
 */
export interface Metadata {
  author: string
  cardData: CardData
  createdAt: string
  description: string
  disabled: boolean
  downloads: number
  gated: boolean
  gguf: GGUF
  id: string
  inference: string
  lastModified: string
  likes: number
  modelId: string
  pipeline_tag: string
  private: boolean
  sha: string
  siblings: Array<{
    rfilename: string
    size: number
  }>
  spaces: string[]
  tags: string[]
  usedStorage: number
  apiKey?: string
}

/**
 * Model source sibling information
 */
export interface ModelSibling {
  id: string
  size: number
}

/**
 * Model source object
 */
export interface ModelSource {
  id: string
  author?: string
  metadata: Metadata
  models: ModelSibling[]
  type?: string
}

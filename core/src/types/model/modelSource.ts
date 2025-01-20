export interface GGUF {
  architecture: string
  bos_token: string
  chat_template: string
  context_length: number
  eos_token: string
  total: number
}

export interface CardData {
  license: string
  pipeline_tag: string
}

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
}

export interface ModelSibling {
  id: string
  size: number
}

export interface ModelSource {
  id: string
  metadata: Metadata
  models: ModelSibling[]
}

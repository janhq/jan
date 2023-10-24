type ItemProperties = {
  name: string
  type: string
  items?: ProductBodyItem[]
  example?: unknown
  description?: string
}

type ProductInput = {
  body: ItemProperties[]
  slug: string
  headers: ProductHeader
}

interface ProductOutput {
  slug: string
  type: string
  properties: ItemProperties[]
  description: string
}

type ProductHeader = {
  accept: string
  contentType: string
}

type ProductBodyItem = {
  type: string
  properties: ItemProperties[]
}

enum ProductType {
  LLM = 'LLM',
  GenerativeArt = 'GenerativeArt',
  ControlNet = 'ControlNet',
}

interface Product {
  _id: string
  name: string
  shortDescription: string
  avatarUrl: string
  longDescription: string
  author: string
  version: string
  modelUrl: string
  nsfw: boolean
  greeting: string
  type: ProductType
  inputs?: ProductInput
  outputs?: ProductOutput
  createdAt: number
  updatedAt?: number
  status: string
  releaseDate: number
  tags: string[]
  availableVersions: ModelVersion[]
}

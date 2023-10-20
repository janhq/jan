export interface ProductInput {
  body: ItemProperties[]
  slug: string
  headers: ProductHeader
}

export type ProductHeader = {
  accept: string
  contentType: string
}

export type ItemProperties = {
  name: string
  type: string
  items?: ProductBodyItem[]
  example?: unknown
  description?: string
}

export type ProductBodyItem = {
  type: string
  properties: ItemProperties[]
}

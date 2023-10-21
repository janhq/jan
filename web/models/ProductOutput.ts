import { ItemProperties } from './ProductInput'

export interface ProductOutput {
  slug: string
  type: string
  properties: ItemProperties[]
  description: string
}

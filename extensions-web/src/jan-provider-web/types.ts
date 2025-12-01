export interface JanModel {
  id: string
  object: string
  owned_by: string
  created?: number
  capabilities: string[]
  supportedParameters?: string[]
  model_display_name?: string
  category?: string
  category_order_number?: number
  model_order_number?: number
}

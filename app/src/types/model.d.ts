interface Model {
  id: string
  object: string
  created: number
  owned_by: string
  model_display_name: string
  category: string
  category_order_number: number
  model_order_number: number
}

interface ModelDetail {
  id: string
  public_id: string
  description: string
  supported_parameters: {
    names: string[]
    default: {
      presence_penalty: string
      repetition_penalty: string
      temperature: string
      top_k: string
      top_p: string
    }
  }
  architecture: {
    modality: string
    input_modalities: string[]
    output_modalities: string[]
    tokenizer: string
    instruct_type: string | null
  }
  notes: string
  is_moderated: boolean
  active: boolean
  extras: {
    created: number
    id: string
    max_model_len: number
    object: string
    owned_by: string
    parent: string | null
    permission: Array<{
      allow_create_engine: boolean
      allow_fine_tuning: boolean
      allow_logprobs: boolean
      allow_sampling: boolean
      allow_search_indices: boolean
      allow_view: boolean
      created: number
      group: string | null
      id: string
      is_blocking: boolean
      object: string
      organization: string
    }>
    root: string
  }
  status: string
  experimental: boolean
  supports_images: boolean
  supports_embeddings: boolean
  supports_tools: boolean
  supports_reasoning: boolean
  supports_audio: boolean
  supports_video: boolean
  supports_instruct: boolean
  supports_browser: boolean
  created_at: number
  updated_at: number
}

export interface HuggingFaceRepoData {
  id: string
  modelId: string
  modelUrl?: string
  author: string
  sha: string
  downloads: number
  lastModified: string
  private: boolean
  disabled: boolean
  gated: boolean
  pipeline_tag: 'text-generation'
  tags: Array<'transformers' | 'pytorch' | 'safetensors' | string>
  cardData: Record<CardDataKeys | string, unknown>
  siblings: {
    rfilename: string
    downloadUrl?: string
    fileSize?: number
    quantization?: Quantization
  }[]
  createdAt: string
}

const CardDataKeys = [
  'base_model',
  'datasets',
  'inference',
  'language',
  'library_name',
  'license',
  'model_creator',
  'model_name',
  'model_type',
  'pipeline_tag',
  'prompt_template',
  'quantized_by',
  'tags',
] as const
export type CardDataKeysTuple = typeof CardDataKeys
export type CardDataKeys = CardDataKeysTuple[number]

export const AllQuantizations = [
  'Q3_K_S',
  'Q3_K_M',
  'Q3_K_L',
  'Q4_K_S',
  'Q4_K_M',
  'Q5_K_S',
  'Q5_K_M',
  'Q4_0',
  'Q4_1',
  'Q5_0',
  'Q5_1',
  'IQ2_XXS',
  'IQ2_XS',
  'Q2_K',
  'Q2_K_S',
  'Q6_K',
  'Q8_0',
  'F16',
  'F32',
  'COPY',
]
export type QuantizationsTuple = typeof AllQuantizations
export type Quantization = QuantizationsTuple[number]

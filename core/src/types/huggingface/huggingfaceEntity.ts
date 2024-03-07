export interface HuggingFaceRepoData {
  id: string
  author: string
  tags: Array<'transformers' | 'pytorch' | 'safetensors' | string>
  siblings: {
    rfilename: string
  }[]
  createdAt: string // ISO 8601 timestamp
}

/* eslint-disable @typescript-eslint/naming-convention */
export enum Quantization {
  Q3_K_S = 'Q3_K_S',
  Q3_K_M = 'Q3_K_M', // eslint-disable-line @typescript-eslint/no-duplicate-enum-values
  Q3_K_L = 'Q3_K_L',
  Q4_K_S = 'Q4_K_S',
  Q4_K_M = 'Q4_K_M', // eslint-disable-line @typescript-eslint/no-duplicate-enum-values
  Q5_K_S = 'Q5_K_S',
  Q5_K_M = 'Q5_K_M', // eslint-disable-line @typescript-eslint/no-duplicate-enum-values
  Q4_0 = 'Q4_0',
  Q4_1 = 'Q4_1',
  Q5_0 = 'Q5_0',
  Q5_1 = 'Q5_1',
  IQ2_XXS = 'IQ2_XXS',
  IQ2_XS = 'IQ2_XS',
  Q2_K = 'Q2_K',
  Q2_K_S = 'Q2_K_S',
  Q6_K = 'Q6_K',
  Q8_0 = 'Q8_0',
  F16 = 'F16',
  F32 = 'F32',
  COPY = 'COPY',
}
/* eslint-enable @typescript-eslint/naming-convention */

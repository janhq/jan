import type { ModelQuant } from '@/services/models/types'

export const GGUF_QUANT_PREFERENCE_ORDER = [
  { quantization: 'Q8_0', aliases: ['q8_0'] },
  { quantization: 'Q6_K', aliases: ['q6_k', 'q6_k_l'] },
  { quantization: 'Q5_K_M', aliases: ['q5_k_m', 'q5_k_s'] },
  {
    quantization: 'Q4_K_M',
    aliases: ['q4_k_m', 'q4_k_s', 'q4_k_xl', 'q4_0'],
  },
  { quantization: 'Q3_K_M', aliases: ['q3_k_m', 'q3_k_s'] },
  { quantization: 'Q2_K', aliases: ['q2_k'] },
  { quantization: 'IQ4_XS', aliases: ['iq4_xs'] },
  { quantization: 'IQ3_M', aliases: ['iq3_m'] },
  { quantization: 'IQ2_M', aliases: ['iq2_m'] },
  { quantization: 'IQ1_M', aliases: ['iq1_m'] },
] as const

export const inferGgufQuantization = (value: string): string | undefined => {
  const normalizedValue = value.toLowerCase()

  return GGUF_QUANT_PREFERENCE_ORDER.find(({ aliases }) =>
    aliases.some((alias) => normalizedValue.includes(alias))
  )?.quantization
}

export const selectBestGgufVariant = (
  quants?: ModelQuant[]
): ModelQuant | undefined => {
  if (!quants?.length) {
    return undefined
  }

  return [...quants].sort((left, right) => {
    const leftQuant = inferGgufQuantization(`${left.model_id} ${left.path}`)
    const rightQuant = inferGgufQuantization(`${right.model_id} ${right.path}`)
    const leftRank = GGUF_QUANT_PREFERENCE_ORDER.findIndex(
      ({ quantization }) => quantization === leftQuant
    )
    const rightRank = GGUF_QUANT_PREFERENCE_ORDER.findIndex(
      ({ quantization }) => quantization === rightQuant
    )
    const normalizedLeftRank =
      leftRank === -1 ? Number.POSITIVE_INFINITY : leftRank
    const normalizedRightRank =
      rightRank === -1 ? Number.POSITIVE_INFINITY : rightRank

    return normalizedLeftRank - normalizedRightRank
  })[0]
}

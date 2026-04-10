export const FIT_LEVEL_TRANSLATION_KEYS: Record<string, string> = {
  'Perfect': 'hub:scoreSummary.fitLevels.perfect',
  'Good': 'hub:scoreSummary.fitLevels.good',
  'Marginal': 'hub:scoreSummary.fitLevels.marginal',
  'Too Tight': 'hub:scoreSummary.fitLevels.tooTight',
}

export const FIT_LEVEL_BADGE_VARIANTS = {
  'Perfect': 'success',
  'Good': 'default',
  'Marginal': 'warning',
  'Too Tight': 'destructive',
} as const

export const getVariantDisplayName = (modelId: string): string =>
  modelId
    .replace(/_GGUF$/i, '')
    .replace(/-GGUF$/i, '')
    .replace(/_TensorRT$/i, '')
    .replace(/-TensorRT$/i, '')

export const isBestQuantVariant = (
  variantModelId: string,
  bestQuant?: string
): boolean => {
  if (!bestQuant) {
    return false
  }

  return getVariantDisplayName(variantModelId)
    .toLowerCase()
    .includes(bestQuant.toLowerCase())
}

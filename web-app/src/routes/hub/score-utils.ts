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
